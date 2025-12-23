#!/bin/bash

# S3 Deployment Script for WallyWeb Frontend
# Make sure you have AWS CLI configured: aws configure

# Use wallyweb profile if AWS_PROFILE not set
export AWS_PROFILE="${AWS_PROFILE:-wallyweb}"

echo "🚀 Deploying WallyWeb frontend to S3..."
echo "📋 Using AWS Profile: $AWS_PROFILE"

# Verify account before proceeding
echo "🔍 Verifying AWS account..."
ACCOUNT_INFO=$(aws sts get-caller-identity --profile "$AWS_PROFILE" 2>&1)
if [ $? -ne 0 ]; then
    echo "❌ Error: Could not verify AWS account. Check your profile configuration."
    echo "$ACCOUNT_INFO"
    exit 1
fi

ACCOUNT_ID=$(echo "$ACCOUNT_INFO" | grep -o '"Account": "[^"]*"' | cut -d'"' -f4)
echo "✅ Using AWS Account: $ACCOUNT_ID"
echo "⚠️  Please verify this is the correct account before proceeding!"
read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled."
    exit 1
fi

# Configuration
BUCKET_NAME="com-wallyweb-homesite"
REGION="us-east-2"

# Check if bucket exists
if ! aws s3 ls "s3://$BUCKET_NAME" --profile "$AWS_PROFILE" 2>&1 | grep -q 'NoSuchBucket'; then
    echo "✅ Bucket exists: $BUCKET_NAME"
else
    echo "📦 Creating bucket: $BUCKET_NAME"
    aws s3 mb "s3://$BUCKET_NAME" --region $REGION --profile "$AWS_PROFILE"
    
    # Enable static website hosting
    echo "🌐 Enabling static website hosting..."
    aws s3 website "s3://$BUCKET_NAME" \
        --index-document index.html \
        --error-document index.html \
        --profile "$AWS_PROFILE"
fi

# Upload files with proper content types
echo "📤 Uploading files with proper content types..."

# Upload HTML files
if [ -f "index.html" ]; then
    aws s3 cp index.html "s3://$BUCKET_NAME/index.html" \
        --content-type "text/html" \
        --profile "$AWS_PROFILE"
fi

# Upload CSS files
if [ -f "styles.css" ]; then
    aws s3 cp styles.css "s3://$BUCKET_NAME/styles.css" \
        --content-type "text/css" \
        --profile "$AWS_PROFILE"
fi

# Upload JavaScript files
if [ -f "script.js" ]; then
    aws s3 cp script.js "s3://$BUCKET_NAME/script.js" \
        --content-type "application/javascript" \
        --profile "$AWS_PROFILE"
fi

# Upload any other files (images, etc.) - these will use default content types
# Note: We exclude the files we already uploaded with correct content types
echo "📤 Uploading other files..."
aws s3 sync . "s3://$BUCKET_NAME" \
    --exclude "*.json" \
    --exclude "node_modules/*" \
    --exclude ".env*" \
    --exclude "server.js" \
    --exclude "lambda/*" \
    --exclude ".git/*" \
    --exclude "*.sh" \
    --exclude "README.md" \
    --exclude "*.zip" \
    --exclude "*.md" \
    --exclude "index.html" \
    --exclude "styles.css" \
    --exclude "script.js" \
    --delete \
    --profile "$AWS_PROFILE"

# Content types are already set during upload above

# Set cache control (optional - cache static assets)
echo "⚙️  Setting cache headers..."
aws s3 cp "s3://$BUCKET_NAME/styles.css" "s3://$BUCKET_NAME/styles.css" \
    --cache-control "max-age=31536000" \
    --metadata-directive REPLACE \
    --profile "$AWS_PROFILE"

aws s3 cp "s3://$BUCKET_NAME/script.js" "s3://$BUCKET_NAME/script.js" \
    --cache-control "max-age=31536000" \
    --metadata-directive REPLACE \
    --profile "$AWS_PROFILE"

echo "✅ Deployment complete!"
echo ""

# Check if CloudFront distribution exists and invalidate cache
echo "🔄 Checking for CloudFront distribution..."
DISTRIBUTION_ID=$(aws cloudfront list-distributions --profile "$AWS_PROFILE" \
    --query "DistributionList.Items[?contains(Origins.Items[0].DomainName, '$BUCKET_NAME')].Id" \
    --output text 2>/dev/null)

if [ -n "$DISTRIBUTION_ID" ] && [ "$DISTRIBUTION_ID" != "None" ]; then
    echo "📋 Found CloudFront distribution: $DISTRIBUTION_ID"
    echo "🔄 Invalidating CloudFront cache..."
    INVALIDATION_ID=$(aws cloudfront create-invalidation \
        --distribution-id "$DISTRIBUTION_ID" \
        --paths "/*" \
        --profile "$AWS_PROFILE" \
        --query 'Invalidation.Id' \
        --output text 2>/dev/null)
    
    if [ $? -eq 0 ] && [ -n "$INVALIDATION_ID" ]; then
        echo "✅ Cache invalidation created: $INVALIDATION_ID"
        echo "⏳ Cache will clear in 1-5 minutes"
    else
        echo "⚠️  Could not create cache invalidation (you may need to do this manually)"
    fi
else
    echo "ℹ️  No CloudFront distribution found for this bucket"
fi

echo ""
echo "🌐 S3 Website URL: http://$BUCKET_NAME.s3-website-$REGION.amazonaws.com"
if [ -n "$DISTRIBUTION_ID" ] && [ "$DISTRIBUTION_ID" != "None" ]; then
    CLOUDFRONT_DOMAIN=$(aws cloudfront get-distribution --id "$DISTRIBUTION_ID" --profile "$AWS_PROFILE" \
        --query 'Distribution.DomainName' --output text 2>/dev/null)
    if [ -n "$CLOUDFRONT_DOMAIN" ]; then
        echo "🌐 CloudFront URL: https://$CLOUDFRONT_DOMAIN"
    fi
fi
echo ""
echo "Next steps:"
echo "1. Wait 1-5 minutes for CloudFront cache to clear (if invalidated)"
echo "2. Configure CORS if needed for API access"
echo "3. Update API_URL in your HTML to point to API Gateway endpoint"

