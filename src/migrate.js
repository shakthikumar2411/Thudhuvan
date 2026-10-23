import fs from 'fs';import {pool} from './lib.js';
await pool.query(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));console.log('Schema ready');await pool.end();
