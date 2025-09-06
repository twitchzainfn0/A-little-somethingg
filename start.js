const { spawn } = require('child_process');

console.log('Starting Roblox Anti-Leak System...');

// Start the API server
console.log('Starting API server...');
const server = spawn('node', ['server.js'], {
    stdio: 'inherit'
});

// Start the Discord bot
console.log('Starting Discord bot...');
const bot = spawn('node', ['bot.js'], {
    stdio: 'inherit'
});

// Handle process termination
process.on('SIGINT', () => {
    console.log('Shutting down...');
    server.kill();
    bot.kill();
    process.exit(0);
});

server.on('close', (code) => {
    console.log(`API server exited with code ${code}`);
});

bot.on('close', (code) => {
    console.log(`Discord bot exited with code ${code}`);
});