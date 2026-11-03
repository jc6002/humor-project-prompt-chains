import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  weight: ['400', '500', '600', '700', '800'],
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Prompt Chain Studio — AI Joke Lab',
  description:
    'Superadmin multi-step multimodal prompt chain workbench for authoring, reordering, running, and inspecting vision-to-comedy caption pipelines.',
};

const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('prompt-chain-studio-theme')||'system';var d=p==='dark'||(p!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=d?'dark':'light';document.documentElement.dataset.theme=r;document.documentElement.dataset.themePref=p;document.documentElement.style.colorScheme=r;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

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
