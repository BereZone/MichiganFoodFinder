const express = require('express');
const cors = require('cors');
const menusHandler = require('./api/menus');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Wrap the Vercel serverless function to work with Express
app.get('/api/menus', (req, res) => {
    menusHandler(req, res);
});

app.listen(port, () => {
    console.log(`Local API server running at http://localhost:${port}`);
});
