const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// Configuration
const LICENSES_DIR = path.join(__dirname, 'licenses');
const LICENSES_FILE = path.join(__dirname, 'licenses.json');

// Ensure directories exist
async function initializeBot() {
    try {
        await fs.access(LICENSES_DIR);
    } catch {
        await fs.mkdir(LICENSES_DIR, { recursive: true });
    }

    try {
        await fs.access(LICENSES_FILE);
    } catch {
        await fs.writeFile(LICENSES_FILE, JSON.stringify({}));
    }
}

// License management functions
async function getLicenses() {
    try {
        const data = await fs.readFile(LICENSES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading licenses:', error);
        return {};
    }
}

async function saveLicenses(licenses) {
    try {
        await fs.writeFile(LICENSES_FILE, JSON.stringify(licenses, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving licenses:', error);
        return false;
    }
}

async function getUsersForLicense(licenseKey) {
    try {
        const filePath = path.join(LICENSES_DIR, `${licenseKey}.txt`);
        const data = await fs.readFile(filePath, 'utf8');
        return data.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
    } catch (error) {
        return [];
    }
}

async function addUserToLicense(licenseKey, username) {
    try {
        const filePath = path.join(LICENSES_DIR, `${licenseKey}.txt`);
        const users = await getUsersForLicense(licenseKey);
        
        if (!users.includes(username)) {
            await fs.appendFile(filePath, `\n${username}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error adding user to license:', error);
        return false;
    }
}

async function removeUserFromLicense(licenseKey, username) {
    try {
        const filePath = path.join(LICENSES_DIR, `${licenseKey}.txt`);
        const users = await getUsersForLicense(licenseKey);
        const updatedUsers = users.filter(user => user !== username);
        
        if (updatedUsers.length !== users.length) {
            await fs.writeFile(filePath, updatedUsers.join('\n'));
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error removing user from license:', error);
        return false;
    }
}

// Utility function to get user's license key
async function getUserLicense(userId) {
    const licenses = await getLicenses();
    return Object.entries(licenses).find(([key, data]) => data.ownerId === userId)?.[0];
}

// Command handlers
const commands = [
    new SlashCommandBuilder()
        .setName('createlicense')
        .setDescription('Create a new license (Bot Owner Only)')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('User who will own this license')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('licensekey')
                .setDescription('Custom license key (optional)')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('authorize')
        .setDescription('Add a user to your approved list')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Roblox username to authorize')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('deauthorize')
        .setDescription('Remove a user from your approved list')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Roblox username to deauthorize')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('authorized')
        .setDescription('List all authorized users'),

    new SlashCommandBuilder()
        .setName('mylicense')
        .setDescription('Show your license information'),

    new SlashCommandBuilder()
        .setName('deletelicense')
        .setDescription('Delete a license (Bot Owner Only)')
        .addStringOption(option =>
            option.setName('licensekey')
                .setDescription('License key to delete')
                .setRequired(true))
];

client.once('ready', async () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    
    // Register slash commands
    try {
        const rest = require('@discordjs/rest');
        const { Routes } = require('discord-api-types/v9');
        
        const restClient = new rest.REST({ version: '9' }).setToken(process.env.DISCORD_TOKEN);
        
        await restClient.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('Successfully registered application commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }

    await initializeBot();
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user } = interaction;

    try {
        switch (commandName) {
            case 'createlicense':
                if (user.id !== process.env.BOT_OWNER_ID) {
                    return interaction.reply({ content: 'Only the bot owner can create licenses!', ephemeral: true });
                }

                const targetUser = interaction.options.getUser('user');
                
                // Check if user already has a license
                const existingLicense = await getUserLicense(targetUser.id);
                if (existingLicense) {
                    return interaction.reply({ content: `This user already has a license: ${existingLicense}`, ephemeral: true });
                }
                
                // Generate a unique license key
                const licenseKey = `license_${targetUser.id}_${Date.now()}`;
                
                const licenses = await getLicenses();

                licenses[licenseKey] = {
                    ownerId: targetUser.id,
                    ownerTag: targetUser.tag,
                    createdAt: new Date().toISOString()
                };

                const success = await saveLicenses(licenses);
                
                if (success) {
                    // Create the license file
                    const filePath = path.join(LICENSES_DIR, `${licenseKey}.txt`);
                    await fs.writeFile(filePath, '# Approved Users List\n# Add one username per line\n');

                    const embed = new EmbedBuilder()
                        .setTitle('License Created Successfully')
                        .setColor(0x00ff00)
                        .addFields(
                            { name: 'License Key', value: licenseKey, inline: true },
                            { name: 'Owner', value: targetUser.tag, inline: true },
                            { name: 'API Endpoint', value: `${process.env.API_URL}/check-user-license/${licenseKey}/{username}`, inline: false }
                        );

                    await interaction.reply({ embeds: [embed] });
                } else {
                    await interaction.reply({ content: 'Failed to create license!', ephemeral: true });
                }
                break;

            case 'authorize':
                const userLicense = await getUserLicense(user.id);
                if (!userLicense) {
                    return interaction.reply({ content: 'You don\'t have a license! Contact the bot owner.', ephemeral: true });
                }

                const usernameToAdd = interaction.options.getString('username');
                const addSuccess = await addUserToLicense(userLicense, usernameToAdd);

                if (addSuccess) {
                    const embed = new EmbedBuilder()
                        .setTitle('User Authorized')
                        .setColor(0x00ff00)
                        .addFields(
                            { name: 'Username', value: usernameToAdd, inline: true },
                            { name: 'License', value: userLicense, inline: true }
                        );
                    await interaction.reply({ embeds: [embed] });
                } else {
                    await interaction.reply({ content: 'User is already authorized or an error occurred!', ephemeral: true });
                }
                break;

            case 'deauthorize':
                const userLicense2 = await getUserLicense(user.id);
                if (!userLicense2) {
                    return interaction.reply({ content: 'You don\'t have a license! Contact the bot owner.', ephemeral: true });
                }

                const usernameToRemove = interaction.options.getString('username');
                const removeSuccess = await removeUserFromLicense(userLicense2, usernameToRemove);

                if (removeSuccess) {
                    const embed = new EmbedBuilder()
                        .setTitle('User Deauthorized')
                        .setColor(0xff0000)
                        .addFields(
                            { name: 'Username', value: usernameToRemove, inline: true },
                            { name: 'License', value: userLicense2, inline: true }
                        );
                    await interaction.reply({ embeds: [embed] });
                } else {
                    await interaction.reply({ content: 'User not found or an error occurred!', ephemeral: true });
                }
                break;

            case 'authorized':
                const userLicense3 = await getUserLicense(user.id);
                if (!userLicense3) {
                    return interaction.reply({ content: 'You don\'t have a license! Contact the bot owner.', ephemeral: true });
                }

                const authorizedUsers = await getUsersForLicense(userLicense3);
                
                const embed = new EmbedBuilder()
                    .setTitle('Authorized Users')
                    .setColor(0x0099ff)
                    .addFields(
                        { name: 'License', value: userLicense3, inline: true },
                        { name: 'Total Users', value: authorizedUsers.length.toString(), inline: true },
                        { name: 'Users', value: authorizedUsers.length > 0 ? authorizedUsers.join('\n') : 'None', inline: false }
                    );

                await interaction.reply({ embeds: [embed] });
                break;

            case 'mylicense':
                const myLicense = await getUserLicense(user.id);
                if (!myLicense) {
                    return interaction.reply({ content: 'You don\'t have a license! Contact the bot owner.', ephemeral: true });
                }

                const myUsers = await getUsersForLicense(myLicense);
                const embed4 = new EmbedBuilder()
                    .setTitle('Your License Information')
                    .setColor(0x0099ff)
                    .addFields(
                        { name: 'License Key', value: myLicense, inline: true },
                        { name: 'Authorized Users', value: myUsers.length.toString(), inline: true },
                        { name: 'API Endpoint', value: `${process.env.API_URL}/check-user-license/${myLicense}/{username}`, inline: false }
                    );

                await interaction.reply({ embeds: [embed4], ephemeral: true });
                break;

            case 'deletelicense':
                if (user.id !== process.env.BOT_OWNER_ID) {
                    return interaction.reply({ content: 'Only the bot owner can delete licenses!', ephemeral: true });
                }

                const keyToDelete = interaction.options.getString('licensekey');
                const allLicenses = await getLicenses();
                
                if (!allLicenses[keyToDelete]) {
                    return interaction.reply({ content: 'License key not found!', ephemeral: true });
                }

                delete allLicenses[keyToDelete];
                const deleteSuccess = await saveLicenses(allLicenses);

                if (deleteSuccess) {
                    // Delete the license file
                    try {
                        const filePath = path.join(LICENSES_DIR, `${keyToDelete}.txt`);
                        await fs.unlink(filePath);
                    } catch (error) {
                        console.error('Error deleting license file:', error);
                    }

                    await interaction.reply({ content: `License ${keyToDelete} deleted successfully!` });
                } else {
                    await interaction.reply({ content: 'Failed to delete license!', ephemeral: true });
                }
                break;
        }
    } catch (error) {
        console.error('Command error:', error);
        if (!interaction.replied) {
            await interaction.reply({ content: 'An error occurred while processing the command!', ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);