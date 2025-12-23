# AWS Account Management Guide for WallyWeb

## Current Account Status

Your current default AWS account: **661452835066** (user: shawnwollenberg)

## Setting Up a Dedicated WallyWeb Profile

### Option 1: Create a New Profile for WallyWeb

1. **Configure a new profile:**
   ```bash
   aws configure --profile wallyweb
   ```
   
   You'll be prompted for:
   - AWS Access Key ID
   - AWS Secret Access Key
   - Default region (use `us-east-2` based on your deploy script)
   - Default output format (json)

2. **Verify the profile:**
   ```bash
   aws sts get-caller-identity --profile wallyweb
   ```
   
   This will show you the account ID, user/role, and ARN.

### Option 2: Use Existing Default Profile

If account `661452835066` is your personal account (not work), you can continue using the default profile.

## Verifying Which Account You're Using

### Check Current Account
```bash
# Shows current default account
aws sts get-caller-identity

# Shows account for specific profile
aws sts get-caller-identity --profile wallyweb
```

### List All Configured Profiles
```bash
cat ~/.aws/config | grep "\[profile" | sed 's/\[profile //' | sed 's/\]//'
```

## Using Profiles in Your Scripts

Your deployment scripts have been updated to use the `AWS_PROFILE` environment variable. You can:

1. **Set profile for a single command:**
   ```bash
   AWS_PROFILE=wallyweb ./deploy-s3.sh
   AWS_PROFILE=wallyweb ./deploy-lambda.sh
   ```

2. **Export for the session:**
   ```bash
   export AWS_PROFILE=wallyweb
   ./deploy-s3.sh
   ./deploy-lambda.sh
   ```

3. **Add to your shell profile (permanent):**
   ```bash
   echo 'export AWS_PROFILE=wallyweb' >> ~/.zshrc
   source ~/.zshrc
   ```

## Quick Account Verification Commands

```bash
# Check current account
aws sts get-caller-identity

# Check account for specific profile
aws sts get-caller-identity --profile wallyweb

# List all accounts you have access to
aws organizations list-accounts --profile wallyweb 2>/dev/null || echo "Not using Organizations"

# Check which profile is active
echo $AWS_PROFILE
```

## Best Practices

1. **Always verify before deploying:**
   ```bash
   aws sts get-caller-identity
   ```

2. **Use explicit profiles in scripts** (already done in your deploy scripts)

3. **Never commit credentials** - they're in `.gitignore`

4. **Use IAM roles** when possible instead of access keys

## Troubleshooting

If you accidentally use the wrong account:

1. **Check what you just created:**
   ```bash
   aws s3 ls --profile wallyweb
   aws lambda list-functions --profile wallyweb
   ```

2. **Switch profile and verify:**
   ```bash
   export AWS_PROFILE=wallyweb
   aws sts get-caller-identity
   ```

3. **Clean up resources** if created in wrong account:
   ```bash
   # List resources
   aws s3 ls
   aws lambda list-functions
   
   # Delete if needed (be careful!)
   # aws s3 rb s3://bucket-name --force
   # aws lambda delete-function --function-name function-name
   ```


