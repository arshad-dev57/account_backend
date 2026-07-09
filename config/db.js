// config/db.js
const { PrismaClient } = require('@prisma/client');

let prisma = null;

const connectDB = () => {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
    });
    console.log('PostgreSQL Connected ✅');
  }
  return prisma;
};

module.exports = connectDB;