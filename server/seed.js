require('dotenv').config({ path: require('path').join(__dirname, '.env') });
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/bookmyshow';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const mongoose = require('mongoose');
const { Movie, Show, Booking } = require('./models');

const poster = (s) => `https://picsum.photos/seed/${s}/300/450`;
const movies = [
  { title: 'Midnight Express', genre: 'Thriller', language: 'Hindi', duration: 138, rating: 8.1, poster: poster('midnight'), description: 'A night train, a missing passenger and a detective with one hour to solve it.' },
  { title: 'Monsoon Melody', genre: 'Romance', language: 'Hindi', duration: 124, rating: 7.6, poster: poster('monsoon'), description: 'Two street musicians in Mumbai find love between the rains.' },
  { title: 'Galaxy Rangers', genre: 'Sci-Fi', language: 'English', duration: 146, rating: 8.4, poster: poster('galaxy'), description: 'A rookie crew must cross a collapsing wormhole to bring humanity home.' },
  { title: 'The Last Laugh', genre: 'Comedy', language: 'Kannada', duration: 119, rating: 7.9, poster: poster('laugh'), description: 'A retired stand-up comic gets one more show, and one big family secret.' },
  { title: 'Iron Valley', genre: 'Action', language: 'Telugu', duration: 152, rating: 8.0, poster: poster('iron'), description: 'A village blacksmith takes on a mining empire to save his land.' },
  { title: 'Paper Boats', genre: 'Drama', language: 'Tamil', duration: 131, rating: 8.6, poster: poster('paper'), description: 'A teacher and her students rebuild a school after the floods.' },
];
const theatres = [
  { theatre: 'PVR Orion Mall', city: 'Bengaluru', price: 250 },
  { theatre: 'INOX Garuda Mall', city: 'Bengaluru', price: 200 },
];
const times = ['10:30 AM', '02:15 PM', '07:30 PM'];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await Promise.all([Movie.deleteMany(), Show.deleteMany(), Booking.deleteMany()]);
  const saved = await Movie.insertMany(movies);
  const shows = [];
  for (const m of saved)
    for (let d = 0; d < 4; d++) {
      const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      for (const t of theatres) for (const time of times)
        shows.push({ movie: m._id, ...t, date, time });
    }
  await Show.insertMany(shows);
  console.log(`Seeded ${saved.length} movies and ${shows.length} shows`);
  process.exit(0);
})();
