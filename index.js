const express = require('express');
const fileUpload = require('multer')({ dest: 'uploads/' });
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// Auth middleware
app.use((req, res, next) => {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ') || auth.split(' ')[1] !== AUTH_TOKEN) {
        return res.status(401).send('Unauthorized');
    }
    next();
});

app.post('/convert', fileUpload.single('file'), (req, res) => {
    const inputPath = req.file.path;
    const outputDir = path.dirname(inputPath);

    exec(`libreoffice --headless --convert-to pdf --outdir ${outputDir} ${inputPath}`, (error) => {
        if (error) return res.status(500).send('Conversion failed.');

        const pdfFile = inputPath.replace(/\.[^/.]+$/, ".pdf");
        res.download(pdfFile, 'converted.pdf', () => {
            fs.unlinkSync(inputPath);
            fs.unlinkSync(pdfFile);
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
