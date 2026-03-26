const app = require('./src/app');
const connectDB = require('./src/config/db');
require('dotenv').config();

connectDB();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});