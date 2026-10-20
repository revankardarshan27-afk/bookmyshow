require('dotenv').config({ path: require('path').join(__dirname, '.env') });
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/bookmyshow';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { User, Movie, Show, Booking } = require('./models');
const { sendMail } = require('./mailer');

const app = express();
app.use(cors());
app.use(express.json());

// Razorpay is only active when both keys are in .env; otherwise demo payment is used
const rzp = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

// ---------- helpers ----------
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => res.status(500).json({ message: e.message }));
const makeToken = (u) => jwt.sign({ id: u._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
const userOut = (u) => ({ name: u.name, email: u.email, isAdmin: u.role === 'admin' });
const isAdminEmail = (email) =>
  !!process.env.ADMIN_EMAIL && email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();

const auth = (req, res, next) => {
  try {
    const token = (req.headers.authorization || '').split(' ')[1];
    req.userId = jwt.verify(token, process.env.JWT_SECRET).id;
    next();
  } catch {
    res.status(401).json({ message: 'Please log in first' });
  }
};
const admin = async (req, res, next) => {
  const u = await User.findById(req.userId);
  if (u && u.role === 'admin') return next();
  res.status(403).json({ message: 'Admins only' });
};

const populateBooking = (q) => q.populate({ path: 'show', populate: { path: 'movie' } });
const ticketText = (b, heading) =>
  `${heading}\n\nMovie: ${b.show.movie.title}\nTheatre: ${b.show.theatre}, ${b.show.city}\n` +
  `Date: ${b.show.date}   Time: ${b.show.time}\nSeats: ${b.seats.join(', ')}\nAmount: Rs ${b.total}\n` +
  `Booking ID: ${b._id}`;

const tryRefund = async (paymentId, amountRupees) => {
  if (!rzp || !paymentId) return;
  try { await rzp.payments.refund(paymentId, { amount: amountRupees * 100 }); }
  catch (e) { console.log('Refund failed:', e.message); }
};

app.get('/', (req, res) => res.send('BookMyShow API is running'));

// ---------- Auth ----------
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ message: 'Name, email and a password of 6+ characters are required' });
  if (await User.findOne({ email: email.toLowerCase() }))
    return res.status(400).json({ message: 'This email is already registered' });
  const user = await User.create({
    name, email, password: await bcrypt.hash(password, 10),
    role: isAdminEmail(email) ? 'admin' : 'user',
  });
  res.json({ token: makeToken(user), user: userOut(user) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: (email || '').toLowerCase() });
  if (!user || !(await bcrypt.compare(password || '', user.password)))
    return res.status(400).json({ message: 'Wrong email or password' });
  if (isAdminEmail(user.email) && user.role !== 'admin') { user.role = 'admin'; await user.save(); }
  res.json({ token: makeToken(user), user: userOut(user) });
}));

// ---------- Movies & shows ----------
app.get('/api/movies', wrap(async (req, res) => res.json(await Movie.find())));

app.get('/api/movies/:id', wrap(async (req, res) => {
  const movie = await Movie.findById(req.params.id);
  if (!movie) return res.status(404).json({ message: 'Movie not found' });
  res.json(movie);
}));

app.get('/api/movies/:id/shows', wrap(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.json(await Show.find({ movie: req.params.id, date: { $gte: today } }).sort('date time'));
}));

app.get('/api/shows/:id', wrap(async (req, res) => {
  const show = await Show.findById(req.params.id).populate('movie');
  if (!show) return res.status(404).json({ message: 'Show not found' });
  res.json(show);
}));

// ---------- Payment ----------
app.post('/api/payments/order', auth, wrap(async (req, res) => {
  const { showId, seats } = req.body;
  if (!Array.isArray(seats) || seats.length === 0 || seats.length > 10)
    return res.status(400).json({ message: 'Choose between 1 and 10 seats' });
  const show = await Show.findById(showId);
  if (!show) return res.status(404).json({ message: 'Show not found' });
  if (seats.some((s) => show.bookedSeats.includes(s)))
    return res.status(409).json({ message: 'Some seats were just taken. Please pick again.' });

  const amount = seats.length * show.price;
  if (!rzp) return res.json({ demo: true, amount });

  const order = await rzp.orders.create({ amount: amount * 100, currency: 'INR', receipt: 'rcpt_' + Date.now() });
  res.json({ demo: false, orderId: order.id, amount, keyId: process.env.RAZORPAY_KEY_ID });
}));

// ---------- Bookings ----------
app.post('/api/bookings', auth, wrap(async (req, res) => {
  const { showId, seats, orderId, paymentId, signature } = req.body;
  if (!Array.isArray(seats) || seats.length === 0 || seats.length > 10)
    return res.status(400).json({ message: 'Choose between 1 and 10 seats' });

  if (rzp) {
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(orderId + '|' + paymentId).digest('hex');
    if (!orderId || !paymentId || expected !== signature)
      return res.status(400).json({ message: 'Payment could not be verified' });
  }

  // Atomic: only succeeds if NONE of the chosen seats is already booked
  const show = await Show.findOneAndUpdate(
    { _id: showId, bookedSeats: { $nin: seats } },
    { $push: { bookedSeats: { $each: seats } } },
    { new: true }
  );
  if (!show) {
    const s = await Show.findById(showId);
    await tryRefund(paymentId, s ? s.price * seats.length : 0);
    return res.status(409).json({ message: 'Some seats were just taken. Please pick again.' });
  }

  const created = await Booking.create({
    user: req.userId, show: show._id, seats, total: seats.length * show.price,
    paymentId: paymentId || 'demo',
  });
  const booking = await populateBooking(Booking.findById(created._id));
  const user = await User.findById(req.userId);
  sendMail(user.email, `Booking confirmed: ${booking.show.movie.title}`,
    ticketText(booking, `Hi ${user.name}, your tickets are confirmed!`)); // not awaited on purpose
  res.json(booking);
}));

app.get('/api/bookings/my', auth, wrap(async (req, res) => {
  res.json(await populateBooking(Booking.find({ user: req.userId }).sort('-createdAt')));
}));

app.patch('/api/bookings/:id/cancel', auth, wrap(async (req, res) => {
  const b = await populateBooking(Booking.findOne({ _id: req.params.id, user: req.userId }));
  if (!b || b.status === 'cancelled') return res.status(400).json({ message: 'Booking not found or already cancelled' });
  if (b.show.date < new Date().toISOString().slice(0, 10))
    return res.status(400).json({ message: 'Past shows cannot be cancelled' });

  await Show.updateOne({ _id: b.show._id }, { $pullAll: { bookedSeats: b.seats } });
  b.status = 'cancelled';
  await b.save();
  await tryRefund(b.paymentId !== 'demo' ? b.paymentId : null, b.total);

  const user = await User.findById(req.userId);
  sendMail(user.email, `Booking cancelled: ${b.show.movie.title}`,
    ticketText(b, `Hi ${user.name}, your booking was cancelled. Any payment will be refunded.`));
  res.json(b);
}));

// ---------- Admin ----------
app.post('/api/admin/movies', auth, admin, wrap(async (req, res) => {
  const { title, genre, language, duration, rating, poster, description } = req.body;
  if (!title) return res.status(400).json({ message: 'Title is required' });
  res.json(await Movie.create({
    title, genre, language, description,
    duration: Number(duration) || 120, rating: Number(rating) || 7,
    poster: poster || `https://picsum.photos/seed/${encodeURIComponent(title)}/300/450`,
  }));
}));

app.delete('/api/admin/movies/:id', auth, admin, wrap(async (req, res) => {
  await Show.deleteMany({ movie: req.params.id });
  await Movie.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));

app.post('/api/admin/shows', auth, admin, wrap(async (req, res) => {
  const { movie, theatre, city, date, time, price } = req.body;
  if (!movie || !theatre || !city || !date || !time || !price)
    return res.status(400).json({ message: 'Fill in all show fields' });
  res.json(await Show.create({ movie, theatre, city, date, time, price: Number(price) }));
}));

// ---------- Start ----------
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    console.log(rzp ? 'Payments: Razorpay' : 'Payments: DEMO mode (no Razorpay keys)');
    app.listen(process.env.PORT || 5000, () =>
      console.log('Server running on http://localhost:' + (process.env.PORT || 5000)));
  })
  .catch((e) => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
