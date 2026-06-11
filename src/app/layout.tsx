import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProvider } from '@/lib/gametime/context/AppContext';
import { TopBar } from '@/components/gametime/TopBar';
import { Sidebar } from '@/components/gametime/Sidebar';
import { BottomNav } from '@/components/gametime/BottomNav';
import { EventDrawer } from '@/components/gametime/EventDrawer';
import { SearchModal } from '@/components/gametime/SearchModal';

export const metadata: Metadata = {
  title: 'GameTime Grid — Live Sports Schedule & TV Guide',
  description: 'See every sport, every game — live now, up next, and this week. Times in your timezone, channels at a glance.',
  keywords: ['sports schedule', 'live sports', 'sports TV guide', 'EPG', 'where to watch'],
  openGraph: {
    title: 'GameTime Grid',
    description: 'Premium sports schedule and EPG — all sports, your timezone, every broadcaster.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0e1117',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <AppProvider>
          <div className="min-h-screen flex flex-col">
            <TopBar />
            <div className="flex flex-1">
              <Sidebar />
              <main className="flex-1 min-w-0 px-4 py-4 pb-safe lg:pb-4">
                <div className="max-w-5xl mx-auto w-full">
                  {children}
                </div>
              </main>
            </div>
            <BottomNav />
          </div>
          <SearchModal />
          <EventDrawer />
        </AppProvider>
      </body>
    </html>
  );
}
