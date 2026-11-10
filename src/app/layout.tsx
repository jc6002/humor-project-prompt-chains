import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const sans = localFont({
  src: './fonts/PlusJakartaSans-Variable.woff2',
  variable: '--font-jakarta',
  weight: '400 800',
  display: 'swap',
});

const mono = localFont({
  src: './fonts/JetBrainsMono-Variable.woff2',
  variable: '--font-jetbrains',
  weight: '400 700',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Hanzi Parts Studio · Visual Chinese Mnemonic Flashcards',
  description:
    'Enter one Simplified Chinese character or compound word and get one stroke-coloured visual mnemonic flashcard powered by Make Me a Hanzi, CC-CEDICT, and heterogeneous Gemini prompt chains.',
};

const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('hanzi-parts-studio-theme')||'system';var d=p==='dark'||(p!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=d?'dark':'light';document.documentElement.dataset.theme=r;document.documentElement.dataset.themePref=p;document.documentElement.style.colorScheme=r;}catch(e){document.documentElement.dataset.theme='light';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col w-full">{children}</body>
    </html>
  );
}
