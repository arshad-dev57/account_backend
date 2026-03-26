const express = require('express');
const app = express();

app.use(express.json());

// ✅ Test route (add this)
app.get('/', (req, res) => {
  res.send('API is running 🚀');
});

const userRoutes = require('./routes/userRoutes');

app.use('/api/users', userRoutes);

module.exports = app;