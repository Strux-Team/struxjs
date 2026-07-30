#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectName = process.argv[2];

if (!projectName) {
    console.error('\x1b[31mError: Please specify the project directory:\x1b[0m');
    console.error('  npx create-struxjs-app <project-directory>');
    process.exit(1);
}

const currentDir = process.cwd();
const projectDir = path.resolve(currentDir, projectName);
const appName = projectName === '.' ? path.basename(currentDir) : projectName;

if (fs.existsSync(projectDir)) {
    if (projectName !== '.') {
        console.error(`\x1b[31mError: Directory '${projectName}' already exists.\x1b[0m`);
        process.exit(1);
    } else {
        // If it's '.', check if directory is empty (allow hidden files like .git)
        const files = fs.readdirSync(projectDir).filter(f => !f.startsWith('.'));
        if (files.length > 0) {
            console.error(`\x1b[31mError: Current directory is not empty.\x1b[0m`);
            process.exit(1);
        }
    }
} else {
    // Create project directory
    fs.mkdirSync(projectDir, { recursive: true });
}

const templateDir = path.resolve(__dirname, 'template');

// Helper to copy files recursively
function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
        fs.mkdirSync(dest, { recursive: true });
        fs.readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

console.log(`\x1b[36m> Creating a new StruxJS app in ${projectDir}...\x1b[0m`);
copyRecursiveSync(templateDir, projectDir);

// Rename _gitignore to .gitignore
if (fs.existsSync(path.join(projectDir, '_gitignore'))) {
    fs.renameSync(path.join(projectDir, '_gitignore'), path.join(projectDir, '.gitignore'));
}

// Rename _vscode to .vscode
if (fs.existsSync(path.join(projectDir, '_vscode'))) {
    fs.renameSync(path.join(projectDir, '_vscode'), path.join(projectDir, '.vscode'));
}

// Copy .env.example to .env
if (fs.existsSync(path.join(projectDir, '.env.example'))) {
    fs.copyFileSync(path.join(projectDir, '.env.example'), path.join(projectDir, '.env'));
}

// Rewrite package.json with new project name
const packageJsonPath = path.join(projectDir, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
packageJson.name = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
packageJson.version = "1.0.0";
packageJson.description = "A new StruxJS application";
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

console.log('\x1b[36m> Installing dependencies (this might take a minute)...\x1b[0m');
try {
    execSync('npm install', { cwd: projectDir, stdio: 'inherit' });
} catch (e) {
    console.error('\x1b[31mError during npm install. You might need to run it manually.\x1b[0m');
}

console.log('\x1b[36m> Generating Application Keys...\x1b[0m');
const envPath = path.join(projectDir, '.env');
if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    // Generate 32-byte base64 strings
    const appKey = crypto.randomBytes(32).toString('base64');
    const jwtSecret = crypto.randomBytes(32).toString('base64');
    
    // Replace APP_KEY
    if (envContent.includes('APP_KEY=')) {
        envContent = envContent.replace(/APP_KEY=.*/, `APP_KEY=${appKey}`);
    } else {
        envContent += `\nAPP_KEY=${appKey}`;
    }
    
    // Replace JWT_SECRET
    if (envContent.includes('JWT_SECRET=')) {
        envContent = envContent.replace(/JWT_SECRET=.*/, `JWT_SECRET=${jwtSecret}`);
    } else {
        envContent += `\nJWT_SECRET=${jwtSecret}`;
    }
    
    fs.writeFileSync(envPath, envContent);
}

console.log('\x1b[36m> Linking Storage...\x1b[0m');
try {
    const storageDirs = [
        'storage/app/public',
        'storage/framework/cache',
        'storage/framework/sessions',
        'storage/framework/views',
        'storage/logs'
    ];
    
    storageDirs.forEach(dir => {
        const fullPath = path.join(projectDir, dir);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        }
        const gitignorePath = path.join(fullPath, '.gitignore');
        if (!fs.existsSync(gitignorePath)) {
            fs.writeFileSync(gitignorePath, "*\n!.gitignore\n");
        }
    });
    
    const targetDir = path.join(projectDir, 'storage', 'app', 'public');
    const linkDir = path.join(projectDir, 'public', 'storage');
    
    if (!fs.existsSync(linkDir)) {
        // Ensure parent directory (public) exists
        if (!fs.existsSync(path.dirname(linkDir))) {
            fs.mkdirSync(path.dirname(linkDir), { recursive: true });
        }
        // Use relative path for symlink to avoid absolute path issues when moving project
        const relativeTarget = path.relative(path.dirname(linkDir), targetDir);
        fs.symlinkSync(relativeTarget, linkDir, 'dir');
    }
} catch (e) {
    console.error('\x1b[33mWarning: Failed to create storage symlink. You might need to run it manually using `npx strux storage:link`.\x1b[0m');
}

console.log(`\n\x1b[32mSuccess! Created ${appName} at ${projectDir}\x1b[0m`);
console.log('Inside that directory, you can run several commands:\n');
console.log('  \x1b[33mnpm run dev\x1b[0m');
console.log('    Starts the development HTTP server.\n');
console.log('  \x1b[33mnpm run dev:assets\x1b[0m');
console.log('    Starts the Vite frontend asset compiler.\n');
console.log('We suggest that you begin by typing:\n');
if (projectName !== '.') {
    console.log(`  \x1b[36mcd ${projectName}\x1b[0m`);
}
console.log('  \x1b[36mnpm run dev\x1b[0m');
console.log('\n\x1b[35mHappy coding with StruxJS!\x1b[0m');
