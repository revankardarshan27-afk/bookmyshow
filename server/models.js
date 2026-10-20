const mongoose = require('mongoose');
const { Schema } = mongoose;

const User = mongoose.model('User', new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
}));

const Movie = mongoose.model('Movie', new Schema({
  title: String, description: String, poster: String,
  genre: String, language: String, duration: Number, rating: Number,
}));

const Show = mongoose.model('Show', new Schema({
  movie: { type: Schema.Types.ObjectId, ref: 'Movie' },
  theatre: String, city: String,
  date: String,            // "YYYY-MM-DD"
  time: String,            // "07:30 PM"
  price: Number,
  bookedSeats: { type: [String], default: [] },
}));

const Booking = mongoose.model('Booking', new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  show: { type: Schema.Types.ObjectId, ref: 'Show' },
  seats: [String],
  total: Number,
  status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' },
  paymentId: String,
}, { timestamps: true }));

module.exports = { User, Movie, Show, Booking };
