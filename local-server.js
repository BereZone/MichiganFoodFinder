const express = require('express');
const cors = require('cors');
const menusHandler = require('./api/menus');
const ingestHandler = require('./api/ingest');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Wrap the Vercel serverless functions to work with Express
app.get('/api/menus', (req, res) => {
    menusHandler(req, res);
});

app.post('/api/ingest', (req, res) => {
    ingestHandler(req, res);
});

app.listen(port, () => {
    console.log(`Local API server running at http://localhost:${port}`);
});
