import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { LoadingState } from './components/common/PageState';
import { AppLayout } from './components/layout/AppLayout';
import { Toaster } from './components/ui/Toaster';
import HomePage from './pages/HomePage';

// Everything but the home page is split into its own chunk; the 3D engine loads only with the hall.
const MoviePage = lazy(() => import('./pages/MoviePage'));
const SeatsPage = lazy(() => import('./pages/SeatsPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const TicketPage = lazy(() => import('./pages/TicketPage'));
const MyTicketsPage = lazy(() => import('./pages/MyTicketsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const HallSandbox = import.meta.env.DEV ? lazy(() => import('./dev/HallSandbox')) : null;

export function App() {
  return (
    <>
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<HomePage />} />
            <Route path="movies/:movieId" element={<MoviePage />} />
            <Route path="showtimes/:showtimeId/checkout" element={<CheckoutPage />} />
            <Route path="tickets" element={<MyTicketsPage />} />
            <Route path="tickets/:code" element={<TicketPage />} />
            <Route path="staff" element={<AdminPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          {/* Full-screen 3D hall: no site header or footer. */}
          <Route path="showtimes/:showtimeId/seats" element={<SeatsPage />} />
          {HallSandbox && <Route path="dev/hall" element={<HallSandbox />} />}
        </Routes>
      </Suspense>
      <Toaster />
    </>
  );
}
