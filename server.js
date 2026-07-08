// server.js
require('dotenv').config();

const app = require('./app');
const connectDB = require('./config/db');

// ✅ Connect to PostgreSQL
const prisma = connectDB();

// ✅ Use PORT from env or default 5000
const PORT = process.env.PORT || 5000;

// 🔹 Listen on all network interfaces
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Database: PostgreSQL ✅`);
});

// ✅ Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  console.log('Disconnected from PostgreSQL');
  process.exit(0);
});