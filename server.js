const app = require('./app');
const connectDB = require('./config/db');
require('dotenv').config();

// ✅ Connect to MongoDB
connectDB();

// ✅ Use PORT from env or default 3000
const PORT = process.env.PORT || 3000;

// 🔹 Listen on all network interfaces (0.0.0.0) for mobile access
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});