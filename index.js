const { Client, GatewayIntentBits, Events, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
require('dotenv').config();

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ]
});

// Store previous controllers and their message IDs
let previousControllers = new Map();

// Function to fetch and process VATSIM data
async function fetchVatsimData() {
    try {
        const response = await fetch("https://data.vatsim.net/v3/vatsim-data.json");
        const data = await response.json();
        
        // Filter controllers with RJ or RO callsigns
        const japanControllers = data.controllers.filter(controller => 
            controller.callsign.startsWith('RJ') || controller.callsign.startsWith('RO')
        );

        // Get the channel
        const channel = await client.channels.fetch(process.env.DISCORD_ATC_UPDATE);
        if (!channel) return;

        // Create a new map of current controllers
        const currentControllers = new Map(japanControllers.map(c => [c.callsign, c]));

        // Check for new controllers and frequency changes
        for (const controller of japanControllers) {
            const existingController = previousControllers.get(controller.callsign);
            
            if (!existingController) {
                // New controller
                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('Controller Online')
                    .addFields(
                        { name: 'Callsign', value: controller.callsign, inline: true },
                        { name: 'Name', value: controller.name, inline: true },
                        { name: 'Frequency', value: controller.frequency, inline: true },
                        { name: 'Facility', value: getFacilityName(controller.facility), inline: true },
                        { name: 'Logon Time', value: new Date(controller.logon_time).toLocaleString('en-US', { 
                            timeZone: 'Asia/Tokyo',
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: false
                        }).replace(/(\d+)\/(\d+)\/(\d+)/, '$3/$1/$2').replace(',', ''), inline: true }
                    )
                    .setTimestamp();

                const message = await channel.send({ embeds: [embed] });
                previousControllers.set(controller.callsign, { messageId: message.id, controller });
            } else if (existingController.controller.frequency !== controller.frequency) {
                // Frequency changed
                try {
                    const message = await channel.messages.fetch(existingController.messageId);
                    if (message) {
                        const embed = new EmbedBuilder()
                            .setColor('#0099ff')
                            .setTitle('Controller Online')
                            .addFields(
                                { name: 'Callsign', value: controller.callsign, inline: true },
                                { name: 'Name', value: controller.name, inline: true },
                                { name: 'Frequency', value: controller.frequency, inline: true },
                                { name: 'Facility', value: getFacilityName(controller.facility), inline: true },
                                { name: 'Logon Time', value: new Date(controller.logon_time).toLocaleString('en-US', { 
                                    timeZone: 'Asia/Tokyo',
                                    year: 'numeric',
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                    hour12: false
                                }).replace(/(\d+)\/(\d+)\/(\d+)/, '$3/$1/$2').replace(',', ''), inline: true }
                            )
                            .setTimestamp();

                        await message.edit({ embeds: [embed] });
                        previousControllers.set(controller.callsign, { messageId: existingController.messageId, controller });
                    }
                } catch (error) {
                    console.error(`Error updating message for ${controller.callsign}:`, error);
                }
            }
        }

        // Check for controllers that went offline
        for (const [callsign, data] of previousControllers) {
            if (!currentControllers.has(callsign)) {
                try {
                    const message = await channel.messages.fetch(data.messageId);
                    if (message) {
                        await message.delete();
                    }
                } catch (error) {
                    console.error(`Error deleting message for ${callsign}:`, error);
                }
                previousControllers.delete(callsign);
            }
        }
    } catch (error) {
        console.error('Error fetching VATSIM data:', error);
    }
}

// Helper function to get facility name
function getFacilityName(facility) {
    const facilities = {
        0: 'Observer',
        1: 'Flight Service Station',
        2: 'Delivery',
        3: 'Ground',
        4: 'Tower',
        5: 'Approach/Departure',
        6: 'Center'
    };
    return facilities[facility] || 'Unknown';
}

// Helper function to get rating name
function getRatingName(rating) {
    const ratings = {
        1: 'Observer',
        2: 'Student 1',
        3: 'Student 2',
        4: 'Student 3',
        5: 'Controller',
        6: 'Instructor',
        7: 'Supervisor'
    };
    return ratings[rating] || 'Unknown';
}

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, async readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
    
    // Check if the channel exists
    try {
        const channel = await client.channels.fetch(process.env.DISCORD_ATC_UPDATE);
        if (!channel) {
            console.error('Error: ATC update channel not found! Please check your DISCORD_ATC_UPDATE environment variable.');
            return;
        }
        console.log(`ATC update channel found: ${channel.name}`);

        // Clean up existing messages
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            if (messages.size > 0) {
                console.log(`Found ${messages.size} messages in the channel, checking for messages to delete...`);
                
                // Filter messages that are less than 14 days old
                const twoWeeksAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
                const messagesToDelete = messages.filter(msg => msg.createdTimestamp > twoWeeksAgo);
                
                if (messagesToDelete.size > 0) {
                    console.log(`Deleting ${messagesToDelete.size} messages that are less than 14 days old...`);
                    await channel.bulkDelete(messagesToDelete);
                    console.log('Successfully cleaned up recent messages');
                } else {
                    console.log('No messages found that are less than 14 days old');
                }
            } else {
                console.log('No existing messages found in the channel');
            }
        } catch (error) {
            console.error('Error cleaning up messages:', error);
        }
    } catch (error) {
        console.error('Error checking ATC update channel:', error);
        return;
    }
    
    // Start fetching VATSIM data every 10 seconds
    setInterval(fetchVatsimData, 10000);
    // Initial fetch
    fetchVatsimData();
});

// Handle slash commands
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        await interaction.editReply(`Pong! 🏓\nLatency: ${latency}ms\nAPI Latency: ${Math.round(interaction.client.ws.ping)}ms`);
    }
});

// Register slash commands when the bot starts
client.once(Events.ClientReady, async () => {
    try {
        const pingCommand = new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Replies with Pong!');

        await client.application.commands.create(pingCommand);
        console.log('Slash commands registered successfully!');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
});

// Add this helper function at the bottom of the file, before the client.login line
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;
    
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

// Login to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);
