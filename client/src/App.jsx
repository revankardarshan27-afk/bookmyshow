import { useEffect, useState, createContext, useContext } from 'react';
import { Routes, Route, Link, useNavigate, useParams, Navigate } from 'react-router-dom';
import { api } from './api.js';

/* ---------- Auth context ---------- */
const AuthCtx = createContext();
const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const login = ({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    setUser(user);
  };
  const logout = () => {
    localStorage.clear();
    setUser(null);
  };
  return <AuthCtx.Provider value={{ user, login, logout }}>{children}</AuthCtx.Provider>;
}

/* ---------- Layout ---------- */
function Navbar() {
  const { user, logout } = useAuth();
  return (
    <header className="nav">
      <Link to="/" className="logo">book<b>my</b>show</Link>
      <nav>
        {user ? (
          <>
            {user.isAdmin && <Link to="/admin">Admin</Link>}
            <Link to="/bookings">My bookings</Link>
            <span className="hello">Hi, {user.name.split(' ')[0]}</span>
            <button className="link" onClick={logout}>Log out</button>
          </>
        ) : (
          <Link to="/login" className="btn small">Log in</Link>
        )}
      </nav>
    </header>
  );
}

/* ---------- Home ---------- */
function Home() {
  const [movies, setMovies] = useState([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api('/movies').then(setMovies).catch((e) => setError(e.message));
  }, []);
  const shown = movies.filter((m) =>
    (m.title + m.genre + m.language).toLowerCase().includes(q.toLowerCase()));
  return (
    <main className="page">
      <h1>Now showing</h1>
      <input className="search" placeholder="Search by title, genre or language"
        value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p className="error">{error}. Is the server running?</p>}
      <div className="grid">
        {shown.map((m) => (
          <Link key={m._id} to={`/movie/${m._id}`} className="card">
            <img src={m.poster} alt={m.title} />
            <div className="card-info">
              <strong>{m.title}</strong>
              <span>{m.genre} · {m.language}</span>
              <span className="rate">★ {m.rating}</span>
            </div>
          </Link>
        ))}
      </div>
      {!error && movies.length > 0 && shown.length === 0 && <p>No movies match "{q}".</p>}
    </main>
  );
}

/* ---------- Movie details + show times (with city filter) ---------- */
function MovieDetail() {
  const { id } = useParams();
  const [movie, setMovie] = useState(null);
  const [shows, setShows] = useState([]);
  const [city, setCity] = useState(localStorage.getItem('city') || '');
  useEffect(() => {
    api(`/movies/${id}`).then(setMovie);
    api(`/movies/${id}/shows`).then(setShows);
  }, [id]);
  if (!movie) return <main className="page">Loading…</main>;

  const cities = [...new Set(shows.map((s) => s.city))].sort();
  const activeCity = cities.includes(city) ? city : '';
  const pickCity = (c) => { setCity(c); localStorage.setItem('city', c); };
  const visible = activeCity ? shows.filter((s) => s.city === activeCity) : shows;
  const byDate = visible.reduce((acc, s) => ((acc[s.date] ||= []).push(s), acc), {});

  return (
    <main className="page">
      <div className="detail">
        <img src={movie.poster} alt={movie.title} />
        <div>
          <h1>{movie.title}</h1>
          <p className="meta">{movie.genre} · {movie.language} · {movie.duration} min · ★ {movie.rating}</p>
          <p>{movie.description}</p>
        </div>
      </div>
      <div className="row-between">
        <h2>Pick a show</h2>
        <label>City{' '}
          <select className="select" value={activeCity} onChange={(e) => pickCity(e.target.value)}>
            <option value="">All cities</option>
            {cities.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      {Object.keys(byDate).length === 0 && <p>No upcoming shows{activeCity ? ` in ${activeCity}` : ''}.</p>}
      {Object.entries(byDate).map(([date, list]) => (
        <section key={date} className="day">
          <h3>{new Date(date).toDateString()}</h3>
          {[...new Set(list.map((s) => s.theatre + '|' + s.city))].map((key) => {
            const [theatre, c] = key.split('|');
            return (
              <div key={key} className="theatre-row">
                <span>{theatre}, {c}</span>
                <div>
                  {list.filter((s) => s.theatre === theatre && s.city === c).map((s) => (
                    <Link key={s._id} to={`/show/${s._id}`} className="time">{s.time}</Link>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </main>
  );
}

/* ---------- Seat selection + payment ---------- */
const ROWS = 'ABCDEFGH'.split('');
const COLS = Array.from({ length: 10 }, (_, i) => i + 1);

const loadRazorpay = () => new Promise((resolve) => {
  if (window.Razorpay) return resolve(true);
  const s = document.createElement('script');
  s.src = 'https://checkout.razorpay.com/v1/checkout.js';
  s.onload = () => resolve(true);
  s.onerror = () => resolve(false);
  document.body.appendChild(s);
});

function SeatPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [show, setShow] = useState(null);
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api(`/shows/${id}`).then(setShow);
  useEffect(() => { load(); }, [id]);
  if (!show) return <main className="page">Loading…</main>;

  const toggle = (seat) => {
    if (show.bookedSeats.includes(seat)) return;
    setPicked((p) => p.includes(seat) ? p.filter((x) => x !== seat) : p.length < 10 ? [...p, seat] : p);
  };

  const confirmBooking = (extra) =>
    api('/bookings', { method: 'POST', body: { showId: id, seats: picked, ...extra } })
      .then(() => nav('/bookings'));

  const pay = async () => {
    if (!user) return nav('/login');
    setBusy(true); setError('');
    try {
      const order = await api('/payments/order', { method: 'POST', body: { showId: id, seats: picked } });

      if (order.demo) {                                   // no Razorpay keys: demo payment
        if (!window.confirm(`Demo payment: pay ₹${order.amount}?`)) { setBusy(false); return; }
        await confirmBooking({});
        return;
      }

      if (!(await loadRazorpay())) throw new Error('Could not load the payment window. Check your internet.');
      new window.Razorpay({
        key: order.keyId,
        amount: order.amount * 100,
        currency: 'INR',
        order_id: order.orderId,
        name: 'BookMyShow Clone',
        description: `${show.movie.title} · ${picked.join(', ')}`,
        prefill: { name: user.name, email: user.email },
        handler: async (r) => {
          try {
            await confirmBooking({
              orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature,
            });
          } catch (e) { setError(e.message); setPicked([]); load(); setBusy(false); }
        },
        modal: { ondismiss: () => setBusy(false) },
      }).open();
    } catch (e) {
      setError(e.message); setPicked([]); load(); setBusy(false);
    }
  };

  return (
    <main className="page">
      <h1>{show.movie.title}</h1>
      <p className="meta">{show.theatre}, {show.city} · {new Date(show.date).toDateString()} · {show.time} · ₹{show.price} per seat</p>
      <div className="screen">Screen this way</div>
      <div className="seats">
        {ROWS.map((r) => (
          <div key={r} className="seat-row">
            <span className="row-label">{r}</span>
            {COLS.map((c) => {
              const seat = r + c;
              const taken = show.bookedSeats.includes(seat);
              const cls = taken ? 'seat taken' : picked.includes(seat) ? 'seat picked' : 'seat';
              return <button key={seat} className={cls} onClick={() => toggle(seat)}
                aria-label={`Seat ${seat}`} disabled={taken}>{c}</button>;
            })}
          </div>
        ))}
      </div>
      <div className="legend"><i className="seat" /> Free <i className="seat picked" /> Yours <i className="seat taken" /> Taken</div>
      {error && <p className="error">{error}</p>}
      <div className="checkout">
        <span>{picked.length ? `${picked.join(', ')} — ₹${picked.length * show.price}` : 'Select your seats'}</span>
        <button className="btn" disabled={!picked.length || busy} onClick={pay}>
          {!user ? 'Log in to book' : busy ? 'Processing…' : `Pay ₹${picked.length * show.price}`}
        </button>
      </div>
    </main>
  );
}

/* ---------- My bookings (with cancel) ---------- */
function Bookings() {
  const { user } = useAuth();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const load = () => api('/bookings/my').then(setList);
  useEffect(() => { if (user) load(); }, [user]);
  if (!user) return <Navigate to="/login" />;
  if (!list) return <main className="page">Loading…</main>;

  const today = new Date().toISOString().slice(0, 10);
  const cancel = async (b) => {
    if (!window.confirm(`Cancel ${b.seats.length} ticket(s) for ${b.show.movie.title}?`)) return;
    setError('');
    try { await api(`/bookings/${b._id}/cancel`, { method: 'PATCH' }); load(); }
    catch (e) { setError(e.message); }
  };

  return (
    <main className="page">
      <h1>My bookings</h1>
      {error && <p className="error">{error}</p>}
      {list.length === 0 && <p>No bookings yet. <Link to="/">Find a movie</Link></p>}
      {list.map((b) => (
        <div key={b._id} className={'ticket' + (b.status === 'cancelled' ? ' cancelled' : '')}>
          <div>
            <strong>{b.show.movie.title}</strong>{' '}
            {b.status === 'cancelled' && <span className="badge">Cancelled</span>}
            <p>{b.show.theatre}, {b.show.city} · {new Date(b.show.date).toDateString()} · {b.show.time}</p>
            <p>Seats: {b.seats.join(', ')}</p>
            {b.status === 'confirmed' && b.show.date >= today &&
              <button className="link" onClick={() => cancel(b)}>Cancel booking</button>}
          </div>
          <div className="amount">₹{b.total}</div>
        </div>
      ))}
    </main>
  );
}

/* ---------- Admin ---------- */
const emptyMovie = { title: '', genre: '', language: '', duration: '', rating: '', poster: '', description: '' };
const emptyShow = { movie: '', theatre: '', city: '', date: '', time: '', price: '' };

function Admin() {
  const { user } = useAuth();
  const [movies, setMovies] = useState([]);
  const [mForm, setMForm] = useState(emptyMovie);
  const [sForm, setSForm] = useState(emptyShow);
  const [msg, setMsg] = useState('');
  const load = () => api('/movies').then(setMovies);
  useEffect(() => { load(); }, []);
  if (!user?.isAdmin) return <main className="page">This page is for admins only. Set ADMIN_EMAIL in server/.env and log in with that email.</main>;

  const setM = (k) => (e) => setMForm({ ...mForm, [k]: e.target.value });
  const setS = (k) => (e) => setSForm({ ...sForm, [k]: e.target.value });
  const run = async (fn, okText) => {
    try { await fn(); setMsg(okText); load(); } catch (e) { setMsg('Error: ' + e.message); }
  };

  return (
    <main className="page">
      <h1>Admin</h1>
      {msg && <p className="notice">{msg}</p>}

      <h2>Add a movie</h2>
      <div className="form grid2">
        <input placeholder="Title *" value={mForm.title} onChange={setM('title')} />
        <input placeholder="Genre" value={mForm.genre} onChange={setM('genre')} />
        <input placeholder="Language" value={mForm.language} onChange={setM('language')} />
        <input placeholder="Duration (minutes)" type="number" value={mForm.duration} onChange={setM('duration')} />
        <input placeholder="Rating (0-10)" type="number" step="0.1" value={mForm.rating} onChange={setM('rating')} />
        <input placeholder="Poster image URL (optional)" value={mForm.poster} onChange={setM('poster')} />
        <input className="wide" placeholder="Description" value={mForm.description} onChange={setM('description')} />
      </div>
      <button className="btn" onClick={() => run(async () => {
        await api('/admin/movies', { method: 'POST', body: mForm }); setMForm(emptyMovie);
      }, 'Movie added')}>Add movie</button>

      <h2>Add a show</h2>
      <div className="form grid2">
        <select className="select wide" value={sForm.movie} onChange={setS('movie')}>
          <option value="">Choose movie *</option>
          {movies.map((m) => <option key={m._id} value={m._id}>{m.title}</option>)}
        </select>
        <input placeholder="Theatre *" value={sForm.theatre} onChange={setS('theatre')} />
        <input placeholder="City *" value={sForm.city} onChange={setS('city')} />
        <input type="date" value={sForm.date} onChange={setS('date')} />
        <input placeholder="Time * e.g. 07:30 PM" value={sForm.time} onChange={setS('time')} />
        <input placeholder="Price per seat (₹) *" type="number" value={sForm.price} onChange={setS('price')} />
      </div>
      <button className="btn" onClick={() => run(async () => {
        await api('/admin/shows', { method: 'POST', body: sForm }); setSForm({ ...emptyShow, movie: sForm.movie });
      }, 'Show added')}>Add show</button>

      <h2>Movies</h2>
      {movies.map((m) => (
        <div key={m._id} className="ticket">
          <div><strong>{m.title}</strong><p>{m.genre} · {m.language}</p></div>
          <button className="link" onClick={() => {
            if (window.confirm(`Delete "${m.title}" and all its shows?`))
              run(() => api(`/admin/movies/${m._id}`, { method: 'DELETE' }), 'Movie deleted');
          }}>Delete</button>
        </div>
      ))}
    </main>
  );
}

/* ---------- Login / Register ---------- */
function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setError('');
    try {
      login(await api(isNew ? '/auth/register' : '/auth/login', { method: 'POST', body: form }));
      nav(-1);
    } catch (err) { setError(err.message); }
  };

  return (
    <main className="page narrow">
      <h1>{isNew ? 'Create account' : 'Log in'}</h1>
      <form onSubmit={submit} className="form">
        {isNew && <input placeholder="Full name" value={form.name} onChange={set('name')} required />}
        <input type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
        <input type="password" placeholder="Password (6+ characters)" value={form.password} onChange={set('password')} required />
        {error && <p className="error">{error}</p>}
        <button className="btn">{isNew ? 'Sign up' : 'Log in'}</button>
      </form>
      <button className="link" onClick={() => setIsNew(!isNew)}>
        {isNew ? 'Already have an account? Log in' : 'New here? Create an account'}
      </button>
    </main>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/movie/:id" element={<MovieDetail />} />
        <Route path="/show/:id" element={<SeatPage />} />
        <Route path="/bookings" element={<Bookings />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<main className="page">Page not found. <Link to="/">Go home</Link></main>} />
      </Routes>
    </AuthProvider>
  );
}
