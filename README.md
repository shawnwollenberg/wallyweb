# WallyWeb Business Website

A modern, responsive business website for WallyWeb with a contact form backend.

## Features

- Modern, responsive design
- Contact form with backend API
- Email notifications for form submissions
- Mobile-friendly navigation
- Smooth animations and transitions

## Local Development

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Setup

1. Install dependencies:
```bash
npm install
```

2. Copy the environment file and configure it:
```bash
cp .env.example .env
```

3. Edit `.env` with your email configuration (see Email Configuration below)

4. Start the development server:
```bash
npm run dev
```

5. Open your browser to `http://localhost:3000`

## Email Configuration

You have three options for sending emails:

### Option 1: Gmail (Development)

1. Enable 2-factor authentication on your Gmail account
2. Generate an app password: https://myaccount.google.com/apppasswords
3. Set in `.env`:
```
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
```

### Option 2: SMTP (Any Provider)

Set in `.env`:
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
EMAIL_USER=your-email@example.com
EMAIL_PASS=your-password
```

### Option 3: AWS SES (Production - Recommended)

1. Verify your email domain in AWS SES
2. Set in `.env`:
```
AWS_SES_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
EMAIL_FROM=noreply@yourdomain.com
CONTACT_EMAIL=contact@yourdomain.com
```

## AWS Hosting Guide

### Recommended Architecture: S3 + CloudFront + API Gateway + Lambda

This is the most cost-effective and scalable solution for a static website with a simple API.

#### Step 1: Host Frontend on S3 + CloudFront

1. **Create S3 Bucket:**
   ```bash
   aws s3 mb s3://wallyweb-frontend
   ```

2. **Upload website files:**
   ```bash
   aws s3 sync . s3://wallyweb-frontend --exclude "*.json" --exclude "node_modules/*" --exclude ".env" --exclude "server.js" --exclude "lambda/*"
   ```

3. **Enable static website hosting:**
   - Go to S3 Console → Your bucket → Properties → Static website hosting
   - Enable and set index document to `index.html`

4. **Create CloudFront Distribution:**
   - Origin: Your S3 bucket
   - Default root object: `index.html`
   - Enable HTTPS
   - Add custom domain (optional)

5. **Update CORS (if needed):**
   - Add CORS configuration to S3 bucket for API access

#### Step 2: Deploy Backend as Lambda Function

1. **Package Lambda function:**
   ```bash
   cd lambda
   npm install
   zip -r ../contact-lambda.zip .
   cd ..
   ```

2. **Create Lambda function:**
   ```bash
   aws lambda create-function \
     --function-name wallyweb-contact \
     --runtime nodejs18.x \
     --role arn:aws:iam::YOUR_ACCOUNT:role/lambda-execution-role \
     --handler contact.handler \
     --zip-file fileb://contact-lambda.zip
   ```

3. **Set environment variables:**
   ```bash
   aws lambda update-function-configuration \
     --function-name wallyweb-contact \
     --environment Variables="{
       CONTACT_EMAIL=contact@yourdomain.com,
       EMAIL_FROM=noreply@yourdomain.com,
       AWS_REGION=us-east-1,
       ALLOWED_ORIGIN=https://yourdomain.com
     }"
   ```

4. **Create API Gateway:**
   - Create REST API
   - Create POST method pointing to Lambda function
   - Enable CORS
   - Deploy to a stage (e.g., `prod`)

5. **Update frontend API URL:**
   - In your HTML, add before closing `</body>`:
   ```html
   <script>
     window.API_URL = 'https://your-api-gateway-url.amazonaws.com/prod/api/contact';
   </script>
   ```

#### Step 3: Configure AWS SES

1. **Verify email/domain in SES:**
   - Go to AWS SES Console
   - Verify the email address or domain you'll send from
   - Move out of SES sandbox (if needed) for production

2. **Grant Lambda permissions:**
   ```bash
   aws lambda add-permission \
     --function-name wallyweb-contact \
     --statement-id allow-ses \
     --action lambda:InvokeFunction \
     --principal ses.amazonaws.com
   ```

### Alternative: AWS Amplify (Easiest)

AWS Amplify provides a simpler full-stack hosting solution:

1. **Install Amplify CLI:**
   ```bash
   npm install -g @aws-amplify/cli
   amplify configure
   ```

2. **Initialize Amplify:**
   ```bash
   amplify init
   ```

3. **Add hosting:**
   ```bash
   amplify add hosting
   amplify publish
   ```

4. **Add API (Lambda function):**
   ```bash
   amplify add api
   # Choose REST API with Lambda function
   # Copy the Lambda code from lambda/contact.js
   ```

### Alternative: EC2/ECS (For Express Server)

If you prefer to run the Express server:

1. **Launch EC2 instance** or **ECS cluster**
2. **Install Node.js and dependencies**
3. **Use PM2 or Docker** to run the server
4. **Set up Application Load Balancer** for HTTPS
5. **Configure security groups** to allow HTTP/HTTPS traffic

### Cost Comparison

- **S3 + CloudFront + Lambda**: ~$1-5/month (very low traffic)
- **Amplify**: ~$15/month (includes CI/CD)
- **EC2**: ~$10-50/month (depending on instance size)

### Domain Setup

1. **Route 53** (AWS DNS):
   - Create hosted zone for your domain
   - Add A record pointing to CloudFront distribution

2. **SSL Certificate**:
   - Request certificate in AWS Certificate Manager
   - Attach to CloudFront distribution

## Production Checklist

- [ ] Configure environment variables
- [ ] Set up AWS SES and verify domain
- [ ] Deploy frontend to S3 + CloudFront
- [ ] Deploy Lambda function
- [ ] Set up API Gateway
- [ ] Configure custom domain
- [ ] Set up SSL certificate
- [ ] Test contact form end-to-end
- [ ] Set up monitoring (CloudWatch)
- [ ] Configure error logging
- [ ] Set up backup/versioning for S3

## File Structure

```
wallyweb/
├── index.html          # Main HTML file
├── styles.css          # Stylesheet
├── script.js           # Frontend JavaScript
├── server.js           # Express server (for local dev)
├── package.json        # Node.js dependencies
├── .env.example        # Environment variables template
├── lambda/             # AWS Lambda function
│   ├── contact.js      # Lambda handler
│   └── package.json    # Lambda dependencies
└── README.md           # This file
```

## API Endpoints

### POST /api/contact

Submit contact form.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "company": "Example Corp",
  "service": "finance",
  "message": "I'm interested in..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Thank you for your message! We'll get back to you soon."
}
```

## Support

For issues or questions, please contact the development team.

