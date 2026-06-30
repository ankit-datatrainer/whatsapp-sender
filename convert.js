const fs = require('fs');
const xlsx = require('xlsx');

// Read all contacts
const rawData = fs.readFileSync('all_contacts.json', 'utf-8');
const contacts = JSON.parse(rawData);

// The categories and their regex patterns (using word boundaries \b to avoid false positives like "Aishwarya" matching "AI")
const categories = {
    'Python': /\bpython\b/i,
    'AI': /\bai\b/i,
    'GenAI': /\bgenai\b/i,
    'Wordpress': /\bwordpress\b/i,
    'Web Development': /\bweb\s*development\b/i,
    'Java': /\bjava\b/i,
    'JavaScript': /\bjavascript\b/i,
    'MS Office': /\bms\s*office\b/i,
    'Family': /\b(father|mother|parents?)\b/i,
    'C#': /(^|\W)c#(\W|$)/i,
    'Numbers': /\bnumbers\b/i,
    'MS Word': /\bms\s*word\b/i,
    'SQL': /\bsql\b/i,
    'Power BI': /\bpower\s*bi\b/i
};

// Create a new Excel workbook
const wb = xlsx.utils.book_new();

// Process each category
for (const [categoryName, regex] of Object.entries(categories)) {
    const bestContacts = new Map();

    contacts.forEach(c => {
        if (!c.name) return;
        
        // Check if the name matches the regex for this category
        if (!regex.test(c.name)) {
            return;
        }

        // Deduplicate internal WhatsApp LIDs by keeping the shortest number
        if (!bestContacts.has(c.name)) {
            bestContacts.set(c.name, c.number);
        } else {
            const existingNumber = bestContacts.get(c.name);
            if (String(c.number).length < String(existingNumber).length) {
                bestContacts.set(c.name, c.number);
            }
        }
    });

    const filteredData = Array.from(bestContacts.entries()).map(([name, number]) => ({
        'Name': name,
        'Phone Number': '+' + number
    }));

    // Convert the array to a sheet
    const ws = xlsx.utils.json_to_sheet(filteredData);
    ws['!cols'] = [{ wch: 35 }, { wch: 20 }];
    
    // Append the sheet to the workbook
    xlsx.utils.book_append_sheet(wb, ws, categoryName);
    console.log(`Added sheet for ${categoryName} with ${filteredData.length} contacts.`);
}

// Write to file
xlsx.writeFile(wb, 'Tech_Contacts_v3.xlsx');
console.log('Successfully created Tech_Contacts_v3.xlsx with all categories!');
