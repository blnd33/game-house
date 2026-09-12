import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { connectStation } from './station/connect.ts';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
connectStation().then(
  station => root.render(<StrictMode><App station={station} /></StrictMode>),
  () => root.render(<p className="fatal">Gaming House could not start. Please ask staff for help.</p>),
);
