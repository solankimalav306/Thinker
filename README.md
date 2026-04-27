# Thinker

Thinker is a premium, AI-powered PDF reading and annotation application built with Electron. It combines a sophisticated reading experience with deep AI integration, allowing you to have natural conversations with your documents.

![App Logo](renderer/assets/logoWhite.png)

## 🌟 Key Features

### 📖 Advanced PDF Reading
- **Multiple View Modes**: Support for Single Page, Two-Page Spread, and Continuous Scroll views.
- **Smart Navigation**: Interactive Table of Contents (Outline) and Thumbnail sidebar for quick jumps.
- **Precision Zoom**: Smooth custom zoom levels and 'Fit to Width' mode for optimal reading.
- **High-Accuracy Selection**: Re-engineered text layer with mathematical baseline alignment for perfect, theme-matched text selection.

### ✍️ Professional Annotations
- **Multi-Tool Support**: Separate Pen and Highlighter tools with individual state persistence.
- **Custom Palettes**: Select any color for your tools; the UI updates dynamically to reflect your choice.
- **Smart Eraser**: Precise path-based erasing to clean up your notes.
- **Auto-Save**: All annotations are automatically persisted to local storage and reloaded upon opening the document.

### 🤖 AI-Powered Chat
- **Talk to PDF**: Ask questions, summarize sections, or explain complex concepts using the Gemini AI integration.
- **Context-Aware**: The AI understands your document content for accurate responses.
- **Persistent History**: Chat conversations are stored per-PDF in `.jsonl` format, allowing you to resume sessions later.

### 🎨 Premium UI & Customization
- **Modern Aesthetics**: Vibrant dark/light modes with glassmorphism and smooth micro-animations.
- **Theme-Level Customization**: Choose a custom accent color, and the entire app's palette (panels, chips, backgrounds) recalculates using `color-mix` for a cohesive look.
- **Stable Animations**: Optimized hero animations on the Home screen prevent layout reflows and flickering.
- **Non-Intrusive Notifications**: Bottom-right toast notification system for status updates and error reporting.

## 🚀 Getting Started

### Prerequisites
- Node.js (v16 or higher recommended)
- A Gemini API Key from [Google AI Studio](https://aistudio.google.com/)

### Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd SmartPDFReader
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Open `.env` and add your Gemini API Key:
     ```env
     GEMINI_API_KEY=your_actual_key_here
     ```

4. **Launch the app**:
   ```bash
   npm start
   ```

## 🛠️ Technical Stack
- **Framework**: Electron.js
- **PDF Engine**: PDF.js
- **AI**: Gemini Pro API
- **Styling**: Vanilla CSS with HSL/OKLCH dynamic variables
- **Icons**: FontAwesome 6
- **Markdown**: marked.js

## 💾 Data Management
- **Settings**: Stored in local JSON/JSONL files (Theme, API Keys, Models).
- **History**: Recent files and chat history are persisted per device.
- **Annotations**: Stored locally and mapped to specific PDF file paths.

---
Built with ❤️ for a better reading experience.
