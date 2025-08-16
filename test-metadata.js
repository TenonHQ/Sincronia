const path = require('path');
const fs = require('fs').promises;

// Import the compiled module
const appUtils = require('./packages/core/dist/appUtils');
const FileUtils = require('./packages/core/dist/FileUtils');

// Create a test record
const testRec = {
  name: 'test-record',
  sys_id: 'test-sys-id',
  files: [
    {
      name: 'script',
      type: 'js',
      content: 'console.log("test");'
    }
  ]
};

// Test path
const testPath = path.join(__dirname, 'test-output');

async function testMetadataCreation() {
  try {
    // Create test directory
    await fs.mkdir(testPath, { recursive: true });
    
    // Mock the writeSNFileCurry function to see what's being written
    const originalWriteSNFileCurry = FileUtils.writeSNFileCurry;
    let metadataWritten = false;
    
    FileUtils.writeSNFileCurry = (forceWrite) => {
      return async (file, recPath) => {
        console.log(`Writing file: ${file.name}.${file.type}`);
        if (file.name === 'metaData' && file.type === 'json') {
          metadataWritten = true;
          console.log('Metadata content:', file.content);
        }
        // Call original function
        return originalWriteSNFileCurry(forceWrite)(file, recPath);
      };
    };
    
    // Call the function
    await appUtils.processFilesInManRec(testPath, testRec, false);
    
    // Check if metadata was written
    if (metadataWritten) {
      console.log('✅ Metadata file was created!');
      
      // Check if file exists on disk
      const metadataPath = path.join(testPath, 'metaData.json');
      try {
        const content = await fs.readFile(metadataPath, 'utf8');
        console.log('✅ Metadata file exists on disk:');
        console.log(content);
      } catch (e) {
        console.log('❌ Metadata file not found on disk');
      }
    } else {
      console.log('❌ Metadata file was NOT created');
    }
    
    // Clean up
    await fs.rm(testPath, { recursive: true, force: true });
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testMetadataCreation();