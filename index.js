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
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});

app.post('/convert', fileUpload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const inputPath = req.file.path;
    const outputDir = path.dirname(inputPath);
    
    // Execute LibreOffice conversion
    exec(`libreoffice --headless --convert-to pdf --outdir ${outputDir} ${inputPath}`, (error, stdout, stderr) => {
        if (error) {
            console.error('Conversion error:', error);
            console.error('stderr:', stderr);
            
            // Clean up input file
            if (fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath);
            }
            
            return res.status(500).json({ error: 'Conversion failed: ' + error.message });
        }
        
        // Construct the output PDF path
        const pdfFile = inputPath.replace(/\.[^/.]+$/, ".pdf");
        
        // Check if PDF was created
        if (!fs.existsSync(pdfFile)) {
            // Clean up input file
            if (fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath);
            }
            return res.status(500).json({ error: 'PDF file was not created' });
        }
        
        try {
            // Read the PDF file
            const pdfBuffer = fs.readFileSync(pdfFile);
            
            // Set proper headers for PDF response
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Length', pdfBuffer.length);
            res.setHeader('Content-Disposition', 'attachment; filename="converted.pdf"');
            
            // Send the PDF buffer directly
            res.send(pdfBuffer);
            
            // Clean up files after sending response
            setTimeout(() => {
                try {
                    if (fs.existsSync(inputPath)) {
                        fs.unlinkSync(inputPath);
                    }
                    if (fs.existsSync(pdfFile)) {
                        fs.unlinkSync(pdfFile);
                    }
                } catch (cleanupError) {
                    console.error('Cleanup error:', cleanupError);
                }
            }, 1000); // Wait 1 second before cleanup
            
        } catch (readError) {
            console.error('Error reading PDF file:', readError);
            
            // Clean up files
            if (fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath);
            }
            if (fs.existsSync(pdfFile)) {
                fs.unlinkSync(pdfFile);
            }
            
            return res.status(500).json({ error: 'Error reading converted PDF file' });
        }
    });
});

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});