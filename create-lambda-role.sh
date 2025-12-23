#!/bin/bash

# Script to create the IAM role needed for Lambda function

# Use wallyweb profile if AWS_PROFILE not set
export AWS_PROFILE="${AWS_PROFILE:-wallyweb}"

echo "🔐 Creating IAM Role for Lambda Function"
echo "========================================="
echo ""

ROLE_NAME="lambda-execution-role"
REGION="${AWS_REGION:-us-east-2}"

# Check if role already exists
EXISTING_ROLE=$(aws iam get-role --role-name "$ROLE_NAME" --profile "$AWS_PROFILE" 2>&1)

if [ $? -eq 0 ]; then
    echo "⚠️  Role $ROLE_NAME already exists"
    echo "Checking trust policy..."
    
    # Check trust policy
    TRUST_POLICY=$(aws iam get-role --role-name "$ROLE_NAME" --profile "$AWS_PROFILE" \
        --query 'Role.AssumeRolePolicyDocument' --output json)
    
    echo "Current trust policy:"
    echo "$TRUST_POLICY" | python3 -m json.tool 2>/dev/null || echo "$TRUST_POLICY"
    
    echo ""
    read -p "Update trust policy? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping role creation. Using existing role."
    else
        # Update trust policy
        echo "Updating trust policy..."
        cat > /tmp/trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
        
        aws iam update-assume-role-policy \
            --role-name "$ROLE_NAME" \
            --policy-document file:///tmp/trust-policy.json \
            --profile "$AWS_PROFILE"
        
        if [ $? -eq 0 ]; then
            echo "✅ Trust policy updated"
        else
            echo "❌ Failed to update trust policy"
            exit 1
        fi
    fi
else
    echo "📋 Creating IAM role: $ROLE_NAME"
    
    # Create trust policy document
    cat > /tmp/trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
    
    # Create the role
    aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document file:///tmp/trust-policy.json \
        --profile "$AWS_PROFILE" \
        --description "Execution role for WallyWeb Lambda functions"
    
    if [ $? -ne 0 ]; then
        echo "❌ Failed to create role"
        exit 1
    fi
    
    echo "✅ Role created"
    
    # Wait a moment for role to be available
    sleep 2
fi

# Attach basic Lambda execution policy
echo ""
echo "📋 Attaching basic Lambda execution policy..."
aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
    --profile "$AWS_PROFILE"

if [ $? -eq 0 ]; then
    echo "✅ Basic execution policy attached"
else
    echo "⚠️  Could not attach basic execution policy (may already be attached)"
fi

# Attach SES policy
echo ""
echo "📋 Attaching SES policy..."
aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonSESFullAccess \
    --profile "$AWS_PROFILE"

if [ $? -eq 0 ]; then
    echo "✅ SES policy attached"
else
    echo "⚠️  Could not attach SES policy (may already be attached)"
fi

# Get account ID for role ARN
ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query 'Account' --output text)
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

echo ""
echo "✅ Role setup complete!"
echo ""
echo "📋 Role ARN:"
echo "$ROLE_ARN"
echo ""
echo "💡 Use this ARN when creating your Lambda function:"
echo ""
echo "aws lambda create-function \\"
echo "  --function-name wallyweb-contact \\"
echo "  --runtime nodejs18.x \\"
echo "  --role $ROLE_ARN \\"
echo "  --handler contact.handler \\"
echo "  --zip-file fileb://contact-lambda.zip \\"
echo "  --region $REGION \\"
echo "  --profile $AWS_PROFILE"
echo ""

# Cleanup
rm -f /tmp/trust-policy.json


