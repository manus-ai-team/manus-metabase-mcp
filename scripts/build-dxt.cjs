#!/usr/bin/env node

/**
 * Build script for creating separate DXT packages for different authentication methods
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration for the two authentication methods
const dxtConfigs = [
  {
    name: 'api-key',
    manifestFile: 'manifest-api-key.json',
    outputFile: 'metabase-mcp-api-key.dxt',
    displayName: 'Metabase (API Key Authentication)',
  },
  {
    name: 'session',
    manifestFile: 'manifest-session.json',
    outputFile: 'metabase-mcp-session.dxt',
    displayName: 'Metabase (Session Authentication)',
  },
];

function log(message) {
  console.log(`[DXT Builder] ${message}`);
}

function buildDxtPackage(config) {
  log(`Building ${config.displayName}...`);
  
  try {
    // Copy the specific manifest to manifest.json
    const manifestPath = path.join(process.cwd(), config.manifestFile);
    const targetManifestPath = path.join(process.cwd(), 'manifest.json');
    
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest file not found: ${config.manifestFile}`);
    }
    
    log(`Using manifest: ${config.manifestFile}`);
    fs.copyFileSync(manifestPath, targetManifestPath);
    
    // Build the DXT package
    const dxtCommand = `dxt pack . ${config.outputFile}`;
    log(`Executing: ${dxtCommand}`);
    
    execSync(dxtCommand, { 
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    log(`Successfully created: ${config.outputFile}`);
    
    // Verify the file was created
    const outputPath = path.join(process.cwd(), config.outputFile);
    if (!fs.existsSync(outputPath)) {
      throw new Error(`DXT file was not created: ${config.outputFile}`);
    }
    
    const stats = fs.statSync(outputPath);
    log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
  } catch (error) {
    log(`Error building ${config.displayName}: ${error.message}`);
    throw error;
  }
}

function main() {
  log('Starting DXT package build process...');
  
  // Ensure we're in the project root
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error('package.json not found. Please run this script from the project root.');
  }
  
  // Build each DXT package
  for (const config of dxtConfigs) {
    buildDxtPackage(config);
  }
  
  log('All DXT packages built successfully!');
  
  // List the created files
  log('\nCreated DXT packages:');
  for (const config of dxtConfigs) {
    const outputPath = path.join(process.cwd(), config.outputFile);
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      log(`  - ${config.outputFile} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    }
  }
  
  // Restore manifest.json to API key version as default
  log('\nRestoring manifest.json to API key version as default...');
  const apiKeyManifestPath = path.join(process.cwd(), 'manifest-api-key.json');
  const targetManifestPath = path.join(process.cwd(), 'manifest.json');
  fs.copyFileSync(apiKeyManifestPath, targetManifestPath);
  log('manifest.json restored to API key version');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[DXT Builder] Fatal error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { buildDxtPackage, dxtConfigs };