const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');

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

client.on('qr', (qr) => {
    console.log('QR Code received. Saving to qr.png...');
    qrcode.toFile('qr.png', qr, {
        scale: 10,
        color: {
            dark: '#000000',  // Black dots
            light: '#FFFFFF' // White background
        }
    }, function (err) {
        if (err) throw err;
        console.log('QR code saved as qr.png! Please open this file and scan it with WhatsApp on your phone.');
    });
});

client.on('ready', async () => {
    console.log('Client is ready! Authentication successful.');
    console.log('Fetching contacts...');

    try {
        const contacts = await client.getContacts();
        
        console.log(`Found ${contacts.length} total contacts.`);
        
        const results = contacts.filter(c => c.name).map(contact => ({
            name: contact.name,
            number: contact.number
        }));

        fs.writeFileSync('all_contacts.json', JSON.stringify(results, null, 2));
        console.log('Successfully saved all contacts to all_contacts.json!');

    } catch (error) {
        console.error('Error fetching contacts:', error);
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
