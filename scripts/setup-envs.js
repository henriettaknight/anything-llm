import fs from 'fs';
import path from 'path';

const files = [
  { src: './frontend/.env.example', dest: './frontend/.env' },
  { src: './server/.env.example', dest: './server/.env.development' },
  { src: './server/.env.example', dest: './server/.env' }, // Prisma needs .env in server dir
  { src: './collector/.env.example', dest: './collector/.env' },
  { src: './docker/.env.example', dest: './docker/.env' }
];

files.forEach(({ src, dest }) => {
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
    console.log(`✓ Copied ${src} to ${dest}`);
  } else {
    console.log(`✓ ${dest} already exists, skipping`);
  }
});

// Ensure DATABASE_URL is set in server/.env for Prisma
const serverEnvPath = './server/.env';
const serverEnvContent = fs.readFileSync(serverEnvPath, 'utf-8');

if (!serverEnvContent.includes('DATABASE_URL')) {
  const defaultDbUrl = 'postgresql://postgres:postgres@localhost:5432/anythingllm';
  fs.appendFileSync(serverEnvPath, `\n# Database Configuration\nDATABASE_URL="${defaultDbUrl}"\n`);
  console.log('✓ Added default DATABASE_URL to server/.env');
}

console.log('\nAll ENV files ready!');
