// models/Activity.js

const mongoose = require('mongoose');

const ActivitySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userName: {
    type: String,
    default: 'Unknown User'  // ✅ Default value add karo
  },
  action: {
    type: String,
    required: true
  },
  actionType: {
    type: String,
    enum: ['stock_in', 'stock_out', 'order', 'add', 'update', 'delete'],
    required: true
  },
  productName: {
    type: String
  },
  quantity: {
    type: Number
  },
  details: {
    type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Activity', ActivitySchema);