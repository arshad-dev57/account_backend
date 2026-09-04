// Reuse the singleton Prisma client. A second PrismaClient here used to open
// another Neon pool and fight the real client for connections.
const prisma = require('../prisma/client');

const connectDB = () => {
  prisma
    .$connect()
    .then(() => console.log('PostgreSQL Connected ✅'))
    .catch((err) => console.error('PostgreSQL connection error:', err.message));
  return prisma;
};

module.exports = connectDB;
