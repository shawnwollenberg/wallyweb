// AWS Lambda function for contact form
// Deploy this to AWS Lambda and connect via API Gateway

const nodemailer = require('nodemailer');
const aws = require('aws-sdk');

// Configure SES transporter
const createTransporter = () => {
  // Get region from environment variable or Lambda context
  // Note: AWS_REGION is automatically set by Lambda, but we use SES_REGION to avoid conflicts
  const region = process.env.SES_REGION || process.env.AWS_REGION || 'us-east-2';
  
  // Create SES instance with region
  const ses = new aws.SES({
    region: region,
  });

  // Use nodemailer with AWS SES
  return nodemailer.createTransport({
    SES: { ses, aws },
  });
};

exports.handler = async (event) => {
  // Handle CORS
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, message: 'Method not allowed' }),
    };
  }

  try {
    // Parse request body
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { name, email, company, service, message } = body;

    // Validate required fields
    if (!name || !email || !service || !message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: 'All required fields must be provided',
        }),
      };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: 'Invalid email format',
        }),
      };
    }

    // Create email content
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: process.env.CONTACT_EMAIL,
      replyTo: email,
      subject: `New Contact Form Submission - ${service}`,
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        ${company ? `<p><strong>Company:</strong> ${company}</p>` : ''}
        <p><strong>Service Interest:</strong> ${service}</p>
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, '<br>')}</p>
      `,
      text: `
        New Contact Form Submission
        
        Name: ${name}
        Email: ${email}
        ${company ? `Company: ${company}` : ''}
        Service Interest: ${service}
        
        Message:
        ${message}
      `,
    };

    // Send email using SES
    const transporter = createTransporter();
    await transporter.sendMail(mailOptions);

    // Optional: Save to DynamoDB or other storage
    // const dynamodb = new AWS.DynamoDB.DocumentClient();
    // await dynamodb.put({...}).promise();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Thank you for your message! We\'ll get back to you soon.',
      }),
    };
  } catch (error) {
    console.error('Error processing contact form:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: 'Something went wrong. Please try again later.',
      }),
    };
  }
};

