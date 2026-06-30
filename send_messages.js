const { Client, LocalAuth } = require('whatsapp-web.js');
const xlsx = require('xlsx');
const fs = require('fs');

// 1. Read the Excel file
console.log('Reading Excel Student.xlsx...');
const workbook = xlsx.readFile('Campagin/Web Development.xlsx');
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(worksheet);

// 2. We will process all contacts now
console.log(`Found ${data.length} contacts to process.`);

// Array to store failed messages
const failedContacts = [];

// Helper function for random delay
const randomDelay = (min, max) => {
    const delay = Math.floor(Math.random() * (max - min + 1) + min);
    return new Promise(resolve => setTimeout(resolve, delay));
};

// 3. Initialize WhatsApp Client
console.log('Initializing WhatsApp client...');
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

client.on('ready', async () => {
    console.log('Client is ready! Authentication successful. Starting bulk messaging...');
    
    for (let i = 0; i < data.length; i++) {
        const contact = data[i];
        let name = contact.Name || contact.name || 'Friend';
        // Clean up name by removing extra spaces just in case
        name = name.trim();
        let phone = contact['Phone Number'] || contact.number || contact.Phone;

        if (!phone) {
            console.log(`Skipping ${name} - No phone number found in sheet.`);
            failedContacts.push({ name, reason: 'No phone number' });
            continue;
        }

        // Format phone number: remove +, spaces, dashes, and append @c.us
        const cleanPhone = String(phone).replace(/\D/g, '');
        const formattedPhone = cleanPhone + '@c.us';
        
        console.log(`[${i+1}/${data.length}] Processing ${name} (${formattedPhone})...`);
        
        try {
            // Check if the number is registered on WhatsApp
            const isRegistered = await client.isRegisteredUser(formattedPhone);
            
            if (!isRegistered) {
                console.log(`❌ Number for ${name} is NOT registered on WhatsApp.`);
                failedContacts.push({ name, phone: cleanPhone, reason: 'Not registered on WhatsApp' });
            } else {
                // Construct the message exactly as requested
                const message = `Hey ${name}! Hope you're doing well. It's been a while, how's everything going these days?`;
                
                await client.sendMessage(formattedPhone, message);
                console.log(`✅ Message successfully sent to ${name}!`);
            }
        } catch (err) {
            console.error(`❌ Failed to send message to ${name}:`, err.message);
            failedContacts.push({ name, phone: cleanPhone, reason: `Error: ${err.message}` });
        }

        // Safety delay between messages (20 to 45 seconds) to prevent ban triggers
        if (i < data.length - 1) {
            const delaySeconds = Math.floor(Math.random() * (45 - 20 + 1)) + 20;
            console.log(`Waiting ${delaySeconds} seconds before next check to avoid ban...`);
            await randomDelay(delaySeconds * 1000, delaySeconds * 1000);
        }
    }

    console.log('All contacts processed!');
    
    if (failedContacts.length > 0) {
        console.log(`Found ${failedContacts.length} failed contacts. Saving to Failed_Messages.json...`);
        fs.writeFileSync('Failed_Messages.json', JSON.stringify(failedContacts, null, 2));
    } else {
        console.log('No failures detected!');
    }

    console.log('Closing client...');
    await client.destroy();
    process.exit(0);
});

client.on('auth_failure', msg => {
    console.error('AUTHENTICATION FAILURE', msg);
    process.exit(1);
});

client.initialize();
