require('dotenv').config();
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const APPROVED_USERS_FILE = path.join(__dirname, 'approved_users.txt');
const LICENSES_DIR = path.join(__dirname, 'licenses');

// Rate limiting to prevent spam
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use(limiter);
app.use(express.json());

// Function to read approved users from file
async function getApprovedUsers() {
  try {
    const data = await fs.readFile(APPROVED_USERS_FILE, 'utf8');
    return data.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')); // Remove empty lines and comments
  } catch (error) {
    console.error('Error reading approved users file:', error);
    return [];
  }
}

// Function to read users for a specific license
async function getUsersForLicense(licenseKey) {
  try {
    const licenseFile = path.join(LICENSES_DIR, `${licenseKey}.txt`);
    const data = await fs.readFile(licenseFile, 'utf8');
    return data.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch (error) {
    console.error(`Error reading license file for ${licenseKey}:`, error);
    return [];
  }
}

// Function to add user to approved list
async function addApprovedUser(username) {
  try {
    const approvedUsers = await getApprovedUsers();
    if (!approvedUsers.includes(username)) {
      await fs.appendFile(APPROVED_USERS_FILE, `\n${username}`);
      return true;
    }
    return false; // User already exists
  } catch (error) {
    console.error('Error adding user:', error);
    return false;
  }
}

// Function to remove user from approved list
async function removeApprovedUser(username) {
  try {
    const approvedUsers = await getApprovedUsers();
    const updatedUsers = approvedUsers.filter(user => user !== username);
    
    if (updatedUsers.length !== approvedUsers.length) {
      await fs.writeFile(APPROVED_USERS_FILE, updatedUsers.join('\n'));
      return true;
    }
    return false; // User not found
  } catch (error) {
    console.error('Error removing user:', error);
    return false;
  }
}

// NEW: Main endpoint for license-based user checking
app.get('/check-user-license/:licenseKey/:username', async (req, res) => {
  const { licenseKey, username } = req.params;
  
  if (!licenseKey || !username) {
    return res.status(400).json({ error: 'License key and username are required' });
  }
  
  try {
    const approvedUsers = await getUsersForLicense(licenseKey);
    const isApproved = approvedUsers.includes(username);
    
    res.json({
      username,
      licenseKey,
      approved: isApproved,
      timestamp: new Date().toISOString()
    });
    
    // Log the check for monitoring
    console.log(`License check: ${licenseKey} - ${username} - ${isApproved ? 'APPROVED' : 'DENIED'}`);
    
  } catch (error) {
    console.error('Error checking user with license:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Original endpoint for backwards compatibility
app.get('/check-user/:username', async (req, res) => {
  const { username } = req.params;
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  try {
    const approvedUsers = await getApprovedUsers();
    const isApproved = approvedUsers.includes(username);
    
    res.json({
      username,
      approved: isApproved,
      timestamp: new Date().toISOString()
    });
    
    // Log the check for monitoring
    console.log(`User check: ${username} - ${isApproved ? 'APPROVED' : 'DENIED'}`);
    
  } catch (error) {
    console.error('Error checking user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin endpoint to add user (you'd want to add authentication here)
app.post('/admin/add-user', async (req, res) => {
  const { username, adminKey } = req.body;
  
  // Simple admin key check (use environment variable in production)
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  const success = await addApprovedUser(username);
  
  if (success) {
    res.json({ message: `User ${username} added successfully` });
  } else {
    res.status(400).json({ error: 'User already exists or error occurred' });
  }
});

// Admin endpoint to remove user
app.post('/admin/remove-user', async (req, res) => {
  const { username, adminKey } = req.body;
  
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  const success = await removeApprovedUser(username);
  
  if (success) {
    res.json({ message: `User ${username} removed successfully` });
  } else {
    res.status(400).json({ error: 'User not found or error occurred' });
  }
});

// Endpoint to list all approved users (admin only)
app.get('/admin/users', async (req, res) => {
  const { adminKey } = req.query;
  
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const approvedUsers = await getApprovedUsers();
  res.json({ users: approvedUsers, count: approvedUsers.length });
});

// NEW: Endpoint to list users for a specific license
app.get('/admin/license-users/:licenseKey', async (req, res) => {
  const { licenseKey } = req.params;
  const { adminKey } = req.query;
  
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const licenseUsers = await getUsersForLicense(licenseKey);
  res.json({ 
    licenseKey, 
    users: licenseUsers, 
    count: licenseUsers.length 
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Initialize approved users file if it doesn't exist
async function initializeUsersFile() {
  try {
    await fs.access(APPROVED_USERS_FILE);
  } catch {
    // File doesn't exist, create it with a comment
    const initialContent = `# Approved Users List
# Add one username per line
# Lines starting with # are comments and will be ignored
# Example:
# YourUsername
# AnotherUser`;
    await fs.writeFile(APPROVED_USERS_FILE, initialContent);
    console.log('Created approved_users.txt file');
  }
}

// Initialize licenses directory
async function initializeLicensesDir() {
  try {
    await fs.access(LICENSES_DIR);
  } catch {
    await fs.mkdir(LICENSES_DIR, { recursive: true });
    console.log('Created licenses directory');
  }
}

app.listen(PORT, async () => {
  await initializeUsersFile();
  await initializeLicensesDir();
  console.log(`Anti-leak API server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`License-based endpoint: http://localhost:${PORT}/check-user-license/{licenseKey}/{username}`);
});

module.exports = app;