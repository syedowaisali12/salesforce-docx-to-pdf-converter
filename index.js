const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// Configure multer for file uploads
const upload = multer({ 
    dest: 'uploads/',
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
    },
    fileFilter: (req, file, cb) => {
        // Check if file is a DOCX
        const allowedMimeTypes = [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/octet-stream' // Sometimes DOCX files are sent as octet-stream
        ];
        
        if (allowedMimeTypes.includes(file.mimetype) || file.originalname.toLowerCase().endsWith('.docx')) {
            cb(null, true);
        } else {
            cb(new Error('Only DOCX files are allowed'), false);
        }
    }
});

// Auth middleware
app.use((req, res, next) => {
    // Skip auth for health check
    if (req.path === '/health') {
        return next();
    }
    
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ') || auth.split(' ')[1] !== AUTH_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Test endpoint to verify LibreOffice is working
app.get('/test-libreoffice', (req, res) => {
    exec('libreoffice --version', (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ 
                error: 'LibreOffice not found', 
                details: error.message 
            });
        }
        res.json({ 
            status: 'LibreOffice available', 
            version: stdout.trim(),
            timestamp: new Date().toISOString()
        });
    });
});

// Main conversion endpoint
app.post('/convert', upload.single('file'), (req, res) => {
    console.log('=== Conversion Request Started ===');
    console.log('File received:', req.file ? req.file.originalname : 'No file');
    console.log('File size:', req.file ? req.file.size : 'N/A');
    console.log('File mimetype:', req.file ? req.file.mimetype : 'N/A');

    if (!req.file) {
        console.log('Error: No file uploaded');
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const inputPath = req.file.path;
    const outputDir = path.dirname(inputPath);
    const baseFileName = path.basename(inputPath, path.extname(inputPath));
    const expectedPdfPath = path.join(outputDir, baseFileName + '.pdf');
    
    console.log('Input path:', inputPath);
    console.log('Output directory:', outputDir);
    console.log('Expected PDF path:', expectedPdfPath);

    // Verify input file exists and is readable
    if (!fs.existsSync(inputPath)) {
        console.log('Error: Input file does not exist');
        return res.status(500).json({ error: 'Input file does not exist' });
    }

    // LibreOffice command with more verbose options
    const command = `libreoffice --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`;
    console.log('Executing command:', command);
    
    // Execute LibreOffice conversion with extended timeout
    exec(command, { timeout: 60000 }, (error, stdout, stderr) => {
        console.log('=== LibreOffice Execution Completed ===');
        console.log('stdout:', stdout);
        console.log('stderr:', stderr);
        
        if (error) {
            console.log('Conversion error:', error.message);
            
            // Clean up input file
            cleanupFile(inputPath);
            
            return res.status(500).json({ 
                error: 'Conversion failed', 
                details: error.message,
                stdout: stdout,
                stderr: stderr
            });
        }
        
        // Check if PDF was created
        console.log('Checking for PDF at:', expectedPdfPath);
        
        if (!fs.existsSync(expectedPdfPath)) {
            console.log('Error: PDF file was not created');
            console.log('Files in output directory:', fs.readdirSync(outputDir));
            
            // Clean up input file
            cleanupFile(inputPath);
            
            return res.status(500).json({ 
                error: 'PDF file was not created',
                expectedPath: expectedPdfPath,
                filesInDirectory: fs.readdirSync(outputDir)
            });
        }
        
        try {
            // Read the PDF file
            console.log('Reading PDF file...');
            const pdfBuffer = fs.readFileSync(expectedPdfPath);
            console.log('PDF file read successfully, size:', pdfBuffer.length, 'bytes');
            
            // Verify it's actually a PDF
            if (pdfBuffer.length < 4 || !pdfBuffer.subarray(0, 4).toString().startsWith('%PDF')) {
                console.log('Error: Generated file is not a valid PDF');
                console.log('File header:', pdfBuffer.subarray(0, 10).toString());
                
                cleanupFiles(inputPath, expectedPdfPath);
                return res.status(500).json({ error: 'Generated file is not a valid PDF' });
            }
            
            // Set proper headers for PDF response
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Length', pdfBuffer.length);
            res.setHeader('Content-Disposition', 'attachment; filename="converted.pdf"');
            
            console.log('Sending PDF response...');
            
            // Send the PDF buffer directly
            res.send(pdfBuffer);
            
            console.log('PDF sent successfully');
            
            // Clean up files after a short delay
            setTimeout(() => {
                cleanupFiles(inputPath, expectedPdfPath);
                console.log('=== Cleanup completed ===');
            }, 2000);
            
        } catch (readError) {
            console.log('Error reading PDF file:', readError.message);
            
            cleanupFiles(inputPath, expectedPdfPath);
            
            return res.status(500).json({ 
                error: 'Error reading converted PDF file',
                details: readError.message
            });
        }
    });
});

// Helper function to clean up a single file
function cleanupFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('Cleaned up file:', filePath);
        }
    } catch (error) {
        console.error('Error cleaning up file:', filePath, error.message);
    }
}

// Helper function to clean up multiple files
function cleanupFiles(...filePaths) {
    filePaths.forEach(filePath => {
        cleanupFile(filePath);
    });
}

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Express error:', error);
    
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
        }
        return res.status(400).json({ error: 'File upload error: ' + error.message });
    }
    
    res.status(500).json({ error: 'Internal server error: ' + error.message });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Available endpoints:');
    console.log(`  GET  /health - Health check`);
    console.log(`  GET  /test-libreoffice - Test LibreOffice installation`);
    console.log(`  POST /convert - Convert DOCX to PDF`);
});