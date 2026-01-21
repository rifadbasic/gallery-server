# 🛠️ Gallery Platform – Backend Server

A secure, scalable **Node.js + Express backend server** for a full-featured **Gallery & Image Marketplace Platform**.  
This server handles **authentication, role-based authorization, image management, payments, watermarking, email notifications**, and more.

Built with real-world production concepts in mind.

---

## 🚀 Project Overview

This backend powers a gallery application where users can:

- Register & login securely
- Subscribe to different plans (Explorer, Artist, Creator)
- Upload images with watermark protection
- Purchase images & subscriptions
- Receive email confirmations
- Access role-restricted APIs
- Track payments, sales, and activity

All APIs are **secured using JWT & Firebase verification**.

---

## 🧩 Core Backend Features

### 🔐 Authentication & Authorization
- Firebase Admin SDK verification
- JWT-based authentication
- Secure token validation middleware
- Role-based access control:
  - Explorer
  - Artist
  - Creator
- Protected routes for sensitive operations

---

### 👥 User Management
- User creation on first login
- Role & status management
- Profile update & fetch APIs
- Account verification & validation
- Secure user data access

---

### 🖼️ Image Management
- Image upload via **Multer**
- Storage using:
  - Cloudinary
  - ImgBB (for watermarked previews)
- Automatic image watermarking using **Sharp**
- Image metadata extraction (width, height, format, size)
- Image status control (Pending / Approved / Premium)
- Image update & delete APIs
- Like & favorite system support

---

### 🖌️ Watermark System
- Dynamic SVG watermark generation
- Tiled watermark across full image
- Rotation & opacity protection
- Ensures original images are never exposed publicly
- Stores:
  - `originalImage`
  - `watermarkedImage`

---

### 💳 Payment System (Stripe)
- Stripe Payment Intents
- Subscription payments
- Image purchase payments
- Secure webhook handling
- Transaction recording in database
- Buyer & seller payment linking
- Earnings calculation for creators

---

### 📊 Payment & Sales Tracking
- Image purchase history
- Subscription history
- User-wise payment filtering
- Earnings summary API
- Pagination support for large datasets

---

### 📧 Email Notifications
- Email confirmation on:
  - Subscription purchase
  - Image purchase
- Powered by **Nodemailer**
- Transaction details included in emails

---

### 🔍 Dashboard APIs
- User dashboard summary
- Uploaded images count
- Purchased images list
- Favorite images list
- Total earnings calculation
- Paginated payment history

---

## 🛡️ Security Practices
- JWT verification middleware
- Firebase token validation
- Role-based API guards
- CORS configuration
- Secure cookies (where applicable)
- No direct public access to sensitive endpoints

---

## 🗄️ Database
- **MongoDB**
- Collections include:
  - users
  - images
  - payments
  - favorites
  - subscriptions
- Optimized queries
- Indexed email-based lookups

---

## 🧪 API Types

- Public APIs (gallery browsing)
- Authenticated APIs (user actions)
- Role-protected APIs (artist / creator)
- Admin-like protected APIs (status updates)

---

## 🛠️ Tech Stack

### Core
- **Node.js**
- **Express.js**
- **MongoDB (Native Driver)**

### Authentication & Security
- **Firebase Admin**
- **JWT**
- **Cookie Parser**
- **CORS**

### File & Image Handling
- **Multer**
- **Sharp**
- **Cloudinary**
- **Streamifier**

### Payments & Emails
- **Stripe**
- **Nodemailer**

### Utilities
- **Axios**
- **dotenv**
- **Form-Data**

---

## 📦 Dependencies

```json
"express": "^5.2.1",
"mongodb": "^7.0.0",
"firebase-admin": "^13.6.0",
"jsonwebtoken": "^9.0.3",
"stripe": "^20.2.0",
"multer": "^2.0.2",
"sharp": "^0.34.5",
"cloudinary": "^2.9.0",
"nodemailer": "^7.0.12"
