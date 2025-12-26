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
  plan: {
    type: String,
    enum: ['personal', 'negocio', 'pro'],
    default: 'personal'
  },
  planStatus: {
    type: String,
    enum: ['active', 'canceled'],
    default: 'active'
  },
  planSince: {
    type: Date,
    default: Date.now
  },
  replaceWindowStart: {
    type: Date
  },
  replaceCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', UserSchema);
