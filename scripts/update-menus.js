const { buildIndex } = require('./api/_lib/scraper');

async function run() {
    console.log("Running scraper...");
    try {
        // Scrape just 1 day to be fast
        const data = await buildIndex(1);
        console.log(`Scraped ${data.length} items.`);

        // Check for station names
        const stations = new Set(data.map(i => i.station));
        console.log("Stations found:", Array.from(stations));

        // Write to client/public/menus.json
        const fs = require('fs');
        const path = require('path');
        const outputPath = path.join(__dirname, 'client', 'public', 'menus.json');

        const outputData = {
            last_updated: new Date().toISOString(),
            menus: data,
            date_range: {
                start: new Date().toISOString().split('T')[0],
                end: new Date().toISOString().split('T')[0] // Just 1 day for now
            }
        };

        fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
        console.log(`Wrote data to ${outputPath}`);

    } catch (e) {
        console.error(e);
    }
}

run();
