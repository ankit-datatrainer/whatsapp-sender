const { Client, LocalAuth } = require('whatsapp-web.js');
const xlsx = require('xlsx');
const fs = require('fs');

// 1. Read the Excel file
console.log('Reading Jobs_leads.xlsx...');
const workbook = xlsx.readFile('Campagin/Jobs_leads.xlsx');
// Use the specific sheet name "Leads"
const worksheet = workbook.Sheets['Leads'];
if (!worksheet) {
    console.error('Sheet "Leads" not found!');
    process.exit(1);
}
const data = xlsx.utils.sheet_to_json(worksheet);

// Limit to first 30 contacts as requested
const contactsToProcess = data.slice(0, 30);
console.log(`Found ${data.length} total contacts. Processing the first ${contactsToProcess.length} contacts.`);

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
    
    for (let i = 0; i < contactsToProcess.length; i++) {
        const contact = contactsToProcess[i];
        let name = contact['FIRST NAME'] || contact['First Name'] || contact.Name || 'Friend';
        // Clean up name by removing extra spaces just in case
        name = name.trim();
        let phone = contact.Number || contact['Phone Number'] || contact.phone;

        if (!phone) {
            console.log(`Skipping ${name} - No phone number found in sheet.`);
            failedContacts.push({ name, reason: 'No phone number' });
            continue;
        }

        // Format phone number: remove non-digits
        let cleanPhone = String(phone).replace(/\D/g, '');
        
        // Ensure US country code (+1) is present
        if (cleanPhone.length === 10) {
            cleanPhone = '1' + cleanPhone; // prepend 1 for 10-digit US numbers
        } else if (cleanPhone.length > 10 && cleanPhone.startsWith('0')) {
            // strip leading zero if present and assume rest is number, maybe prepend 1?
            cleanPhone = '1' + cleanPhone.substring(1);
        }
        
        const formattedPhone = cleanPhone + '@c.us';
        
        console.log(`[${i+1}/${contactsToProcess.length}] Processing ${name} (${formattedPhone})...`);
        
        try {
            // Check if the number is registered on WhatsApp
            const isRegistered = await client.isRegisteredUser(formattedPhone);
            
            if (!isRegistered) {
                console.log(`❌ Number for ${name} is NOT registered on WhatsApp.`);
                failedContacts.push({ name, phone: cleanPhone, reason: 'Not registered on WhatsApp' });
            } else {
                // Construct the message exactly as requested
                const message = `Hey ${name}! I came across your profile and noticed you're working in IT. I work with professionals who want to get into Generative & Agentic AI — just wanted to connect. Hope that's okay! 😊`;
                
                await client.sendMessage(formattedPhone, message);
                console.log(`✅ Message successfully sent to ${name}!`);
            }
        } catch (err) {
            console.error(`❌ Failed to send message to ${name}:`, err.message);
            failedContacts.push({ name, phone: cleanPhone, reason: `Error: ${err.message}` });
        }

        // Safety delay between messages (20 to 45 seconds) to prevent ban triggers
        if (i < contactsToProcess.length - 1) {
            const delaySeconds = Math.floor(Math.random() * (45 - 20 + 1)) + 20;
            console.log(`Waiting ${delaySeconds} seconds before next check to avoid ban...`);
            await randomDelay(delaySeconds * 1000, delaySeconds * 1000);
        }
    }

    console.log('All contacts processed!');
    
    if (failedContacts.length > 0) {
        console.log(`Found ${failedContacts.length} failed contacts. Saving to Failed_Messages_Jobs.json...`);
        fs.writeFileSync('Failed_Messages_Jobs.json', JSON.stringify(failedContacts, null, 2));
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
