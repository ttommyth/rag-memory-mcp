# 🔐 SSL Certificate Configuration Guide

## 📋 **Overview**

The RAG Memory MCP server now supports comprehensive SSL certificate configuration for PostgreSQL connections, including:

- **Basic SSL** (with/without certificate validation)
- **Custom CA certificates** (for private/self-signed CAs)
- **Mutual TLS (mTLS)** (client certificate authentication)
- **Certificate files** (for complex SSL setups)

## 🎯 **SSL Configuration Options**

### **1. Basic SSL (Default - Secure)**
```json
{
  "env": {
    "PG_SSL": "true"
  }
}
```
- ✅ Validates server certificates against system CA store
- ✅ Secure by default
- ✅ Works with legitimate SSL providers (AWS RDS, Neon, etc.)

### **2. SSL with Self-Signed Certificates (Aiven)**
```json
{
  "env": {
    "PG_SSL": "true",
    "PG_SSL_REJECT_UNAUTHORIZED": "false"
  }
}
```
- ⚠️ Disables certificate validation
- ✅ Works with self-signed certificates (Aiven, local dev)
- ⚠️ Less secure - use only when necessary

### **3. SSL with Custom CA Certificate**
```json
{
  "env": {
    "PG_SSL": "true",
    "PG_SSL_CA_FILE": "/path/to/ca-certificate.pem"
  }
}
```
- ✅ Validates against custom CA certificate
- ✅ Secure for private/corporate CAs
- ✅ Best practice for custom certificate authorities

### **4. Mutual TLS (Client Certificate Authentication)**
```json
{
  "env": {
    "PG_SSL": "true",
    "PG_SSL_CA_FILE": "/path/to/ca-certificate.pem",
    "PG_SSL_CERT_FILE": "/path/to/client-certificate.pem",
    "PG_SSL_KEY_FILE": "/path/to/client-private-key.pem"
  }
}
```
- 🔒 Highest security level
- ✅ Server validates client certificate
- ✅ Client validates server certificate
- ✅ Required for some enterprise PostgreSQL setups

## 🌐 **Provider-Specific Examples**

### **Aiven PostgreSQL**
```json
{
  "mcpServers": {
    "rag-memory": {
      "command": "npx",
      "args": ["-y", "rag-memory-mcp"],
      "env": {
        "DB_TYPE": "postgresql",
        "PG_HOST": "your-project.aivencloud.com",
        "PG_PORT": "11910",
        "PG_DATABASE": "your_database",
        "PG_USERNAME": "avnadmin",
        "PG_PASSWORD": "your_password",
        "PG_SSL": "true",
        "PG_SSL_REJECT_UNAUTHORIZED": "false"
      }
    }
  }
}
```

### **AWS RDS with Custom CA**
```json
{
  "mcpServers": {
    "rag-memory": {
      "command": "npx",
      "args": ["-y", "rag-memory-mcp"],
      "env": {
        "DB_TYPE": "postgresql",
        "PG_HOST": "your-instance.region.rds.amazonaws.com",
        "PG_PORT": "5432",
        "PG_DATABASE": "your_database",
        "PG_USERNAME": "your_username",
        "PG_PASSWORD": "your_password",
        "PG_SSL": "true",
        "PG_SSL_CA_FILE": "/path/to/rds-ca-2019-root.pem"
      }
    }
  }
}
```

### **Google Cloud SQL with Mutual TLS**
```json
{
  "mcpServers": {
    "rag-memory": {
      "command": "npx",
      "args": ["-y", "rag-memory-mcp"],
      "env": {
        "DB_TYPE": "postgresql",
        "PG_HOST": "your-ip-address",
        "PG_PORT": "5432",
        "PG_DATABASE": "your_database",
        "PG_USERNAME": "your_username",
        "PG_PASSWORD": "your_password",
        "PG_SSL": "true",
        "PG_SSL_CA_FILE": "/path/to/server-ca.pem",
        "PG_SSL_CERT_FILE": "/path/to/client-cert.pem",
        "PG_SSL_KEY_FILE": "/path/to/client-key.pem"
      }
    }
  }
}
```

### **Corporate/Enterprise PostgreSQL**
```json
{
  "mcpServers": {
    "rag-memory": {
      "command": "npx",
      "args": ["-y", "rag-memory-mcp"],
      "env": {
        "DB_TYPE": "postgresql",
        "PG_HOST": "postgres.company.com",
        "PG_PORT": "5432",
        "PG_DATABASE": "rag_memory",
        "PG_USERNAME": "service_account",
        "PG_PASSWORD": "secure_password",
        "PG_SSL": "true",
        "PG_SSL_CA_FILE": "/etc/ssl/certs/company-ca.pem",
        "PG_SSL_CERT_FILE": "/etc/ssl/certs/client.pem",
        "PG_SSL_KEY_FILE": "/etc/ssl/private/client-key.pem"
      }
    }
  }
}
```

## 📁 **Certificate File Formats**

### **CA Certificate (PG_SSL_CA_FILE)**
```
-----BEGIN CERTIFICATE-----
MIIEUDCCArigAwIBAgIUNh7Q9B3sbraP+eUBPT8KKEiBj+kwDQYJKoZIhvcNAQEM
BQAwQDE+MDwGA1UEAww1YjIzNTYxZDYtZGIxYi00ODVmLThkMjAtMWNmYjE3MGNh
...
-----END CERTIFICATE-----
```

### **Client Certificate (PG_SSL_CERT_FILE)**
```
-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKoK/OvD/A8SMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
BAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX
...
-----END CERTIFICATE-----
```

### **Private Key (PG_SSL_KEY_FILE)**
```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKB
wko6OmwjXnqPEmu5WiUQs03CIA3FLlvHCgGSMxKTz4ePz7FzB7odTEfFwTOvTK0G
...
-----END PRIVATE KEY-----
```

## 🔧 **Environment Variables Reference**

| Variable | Description | Example |
|----------|-------------|---------|
| `PG_SSL` | Enable SSL connection | `"true"`, `"false"` |
| `PG_SSL_REJECT_UNAUTHORIZED` | Validate server certificates | `"true"` (default), `"false"` |
| `PG_SSL_CA_FILE` | Path to CA certificate file | `"/path/to/ca.pem"` |
| `PG_SSL_CERT_FILE` | Path to client certificate file | `"/path/to/client.pem"` |
| `PG_SSL_KEY_FILE` | Path to client private key file | `"/path/to/client-key.pem"` |

## 🧪 **Testing SSL Configuration**

### **Test Basic Connection**
```bash
DB_TYPE=postgresql \
PG_HOST=your-host \
PG_PORT=5432 \
PG_DATABASE=your_db \
PG_USERNAME=your_user \
PG_PASSWORD=your_pass \
PG_SSL=true \
node dist/index.js
```

### **Test with Certificate Files**
```bash
DB_TYPE=postgresql \
PG_HOST=your-host \
PG_PORT=5432 \
PG_DATABASE=your_db \
PG_USERNAME=your_user \
PG_PASSWORD=your_pass \
PG_SSL=true \
PG_SSL_CA_FILE=/path/to/ca.pem \
PG_SSL_CERT_FILE=/path/to/client.pem \
PG_SSL_KEY_FILE=/path/to/client-key.pem \
node dist/index.js
```

## 🚨 **Security Best Practices**

### **✅ Recommended (Secure)**
1. **Use legitimate SSL certificates** when possible
2. **Keep `PG_SSL_REJECT_UNAUTHORIZED=true`** (default) for production
3. **Use certificate files** for custom CAs instead of disabling validation
4. **Protect private key files** with proper file permissions (600)
5. **Use mutual TLS** for high-security environments

### **⚠️ Use with Caution**
1. **`PG_SSL_REJECT_UNAUTHORIZED=false`** - Only for self-signed certificates
2. **Storing certificates in environment variables** - Use files instead
3. **Unencrypted connections** (`PG_SSL=false`) - Only for development

### **❌ Never Do**
1. **Disable SSL in production** without proper network security
2. **Share private key files** or commit them to version control
3. **Use self-signed certificates** in production without proper CA validation

## 🔍 **Troubleshooting**

### **Common SSL Errors**

#### **"self-signed certificate in certificate chain"**
```bash
# Solution: Add CA certificate or disable validation
PG_SSL_CA_FILE=/path/to/ca.pem
# OR (less secure)
PG_SSL_REJECT_UNAUTHORIZED=false
```

#### **"certificate verify failed"**
```bash
# Solution: Check CA certificate path and validity
ls -la /path/to/ca.pem
openssl x509 -in /path/to/ca.pem -text -noout
```

#### **"no pg_hba.conf entry for host"**
```bash
# Solution: Enable SSL in PostgreSQL configuration
# This is a server-side configuration issue
```

#### **"ENOENT: no such file or directory"**
```bash
# Solution: Check certificate file paths
ls -la /path/to/certificate.pem
```

## 📊 **SSL Configuration Matrix**

| Scenario | PG_SSL | PG_SSL_REJECT_UNAUTHORIZED | Certificate Files | Security Level |
|----------|--------|---------------------------|-------------------|----------------|
| **No SSL** | `false` | N/A | None | ❌ Low |
| **Basic SSL** | `true` | `true` (default) | None | ✅ High |
| **Self-Signed** | `true` | `false` | None | ⚠️ Medium |
| **Custom CA** | `true` | `true` | CA file | ✅ High |
| **Mutual TLS** | `true` | `true` | CA + Client cert + Key | 🔒 Highest |

---

## 🎯 **Quick Reference**

**For most users**: Use basic SSL (`PG_SSL=true`) - it's secure and works with standard providers.

**For Aiven**: Add `PG_SSL_REJECT_UNAUTHORIZED=false` due to self-signed certificates.

**For custom CAs**: Use `PG_SSL_CA_FILE` instead of disabling validation.

**For enterprise**: Use mutual TLS with all certificate files for maximum security.