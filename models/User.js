const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  dui: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['viewer', 'basic', 'admin'],
    default: 'viewer'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', UserSchema);
