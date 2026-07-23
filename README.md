# AI ITR Filing Assistant

**Upload Once. File Smart. Save Maximum.**

An AI-powered Indian Income Tax Return (ITR) filing assistant that extracts real data from uploaded Form 16, AIS/26AS PDFs, performs intelligent tax calculations, and recommends the optimal tax regime for FY 2025-26 (AY 2026-27).

---

## Features

- **Smart PDF Parsing** — Extracts actual salary, TDS, PAN, savings interest from Form 16 (Part A & B) and AIS documents
- **Capital Gains Engine** — Parses Equity Share & Mutual Fund transactions from AIS/26AS (SFT-017 & SFT-17-EMF)
- **Regime Comparison** — Real-time Old vs New Tax Regime comparison with FY 2025-26 slabs
- **Detailed Tax Sheet** — Step-by-step slab-wise breakdown with Section 87A rebate, cess and deductions
- **Gov Reconciliation** — Matches your filed income against AIS/26AS government portal data
- **AI Tax Advisor** — Context-aware chatbot that answers tax questions using your actual numbers
- **Calculator Persistence** — HRA, Home Loan, Business Presumptive, and Capital Gains calculators with save & restore
- **Document Management** — Upload, delete, and reclassify documents (Form 16 Part A/B, AIS, PAN, Aadhaar, etc.)

## Tax Rules — FY 2025-26 (AY 2026-27)

| Slab | New Regime Rate |
|------|----------------|
| Up to ₹4 Lakh | 0% |
| ₹4L – ₹8L | 5% |
| ₹8L – ₹12L | 10% |
| ₹12L – ₹16L | 15% |
| ₹16L – ₹20L | 20% |
| ₹20L – ₹24L | 25% |
| Above ₹24L | 30% |

- **Standard Deduction:** ₹75,000 (New Regime), ₹50,000 (Old Regime)
- **Section 87A Rebate:** Zero tax for taxable income up to ₹12,00,000
- **STCG (Equity):** 20% | **LTCG (Equity):** 12.5% above ₹1.25 Lakh threshold

---

## Tech Stack

- **Backend:** Node.js + Express.js
- **Database:** JSON flat-file (database.json)
- **PDF Parsing:** pdf-parse
- **Frontend:** Vanilla HTML/CSS/JavaScript

## Setup

`ash
# Clone the repository
git clone <repo-url>
cd ai-itr-filing-assistant

# Install dependencies
npm install

# Copy example database (first time)
cp database.example.json database.json

# Create uploads folder
mkdir uploads

# Start the server
npm run dev
`

Then open http://localhost:3000 in your browser.

## Environment

No .env file needed for local usage. Firebase config is optional (app runs in mock auth mode on localhost).

---

## Disclaimer

This application is for educational and demonstration purposes. Always verify tax calculations with a Chartered Accountant before filing your actual return.
