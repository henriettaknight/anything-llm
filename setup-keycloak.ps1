# Keycloak 自动配置脚本
# 此脚本将自动配置 Keycloak 用于 AnythingLLM 集成测试

$ErrorActionPreference = "Stop"

# 配置参数
$KEYCLOAK_URL = "http://localhost:8080"
$ADMIN_USERNAME = "admin"
$ADMIN_PASSWORD = "admin"
$REALM_NAME = "anythingllm"
$BACKEND_CLIENT_ID = "anythingllm-backend"
$FRONTEND_CLIENT_ID = "anythingllm-frontend"
$TEST_USERNAME = "testuser"
$TEST_PASSWORD = "testpass123"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Keycloak 自动配置脚本" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 函数：获取管理员访问令牌
function Get-AdminToken {
    Write-Host "正在获取管理员访问令牌..." -ForegroundColor Yellow
    
    $body = @{
        username   = $ADMIN_USERNAME
        password   = $ADMIN_PASSWORD
        grant_type = "password"
        client_id  = "admin-cli"
    }
    
    try {
        $response = Invoke-RestMethod -Uri "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" `
            -Method Post `
            -Body $body `
            -ContentType "application/x-www-form-urlencoded"
        
        Write-Host "✓ 成功获取管理员令牌" -ForegroundColor Green
        return $response.access_token
    }
    catch {
        Write-Host "✗ 获取管理员令牌失败: $($_.Exception.Message)" -ForegroundColor Red
        throw
    }
}

# 函数：创建 Realm
function Create-Realm {
    param($token)
    
    Write-Host ""
    Write-Host "正在创建 Realm '$REALM_NAME'..." -ForegroundColor Yellow
    
    $headers = @{
        "Authorization" = "Bearer $token"
        "Content-Type"  = "application/json"
    }
    
    $realmConfig = @{
        realm   = $REALM_NAME
        enabled = $true
    } | ConvertTo-Json
    
    try {
        Invoke-RestMethod -Uri "$KEYCLOAK_URL/admin/realms" `
            -Method Post `
            -Headers $headers `
            -Body $realmConfig `
            -ContentType "application/json"
        
        Write-Host "✓ Realm '$REALM_NAME' 创建成功" -ForegroundColor Green
    }
    catch {
        if ($_.Exception.Response.StatusCode -eq 409) {
            Write-Host "⚠ Realm '$REALM_NAME' 已存在，跳过创建" -ForegroundColor Yellow
        }
        else {
            Write-Host "✗ 创建 Realm 失败: $($_.Exception.Message)" -ForegroundColor Red
            throw
        }
    }
}

# 函数：创建后端 Client
function Create-BackendClient {
    param($token)
    
    Write-Host ""
    Write-Host "正在创建后端 Client '$BACKEND_CLIENT_ID'..." -ForegroundColor Yellow
    
    $headers = @{
        "Authorization" = "Bearer $token"
        "Content-Type"  = "application/json"
    }
    
    $clientConfig = @{
        clientId                 = $BACKEND_CLIENT_ID
        enabled                  = $true
        protocol                 = "openid-connect"
        publicClient             = $false
        serviceAccountsEnabled   = $true
        directAccessGrantsEnabled = $true
        standardFlowEnabled      = $false
        redirectUris             = @("http://localhost:3001/*")
        webOrigins               = @("http://localhost:3001")
    } | ConvertTo-Json
    
    try {
        Invoke-RestMethod -Uri "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients" `
            -Method Post `
            -Headers $headers `
            -Body $clientConfig `
            -ContentType "application/json"
        
        Write-Host "✓ 后端 Client '$BACKEND_CLIENT_ID' 创建成功" -ForegroundColor Green
        
        # 获取 Client Secret
        Start-Sleep -Seconds 1
        $clients = Invoke-RestMethod -Uri "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$BACKEND_CLIENT_ID" `
            -Method Get `
            -Headers $headers
        
        $clientUuid = $clients[0].id
        $secret = Invoke-RestMethod -Uri "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients/$clientUuid/client-secret" `
            -Method Get `
            -Headers $headers
        
        Write-Host ""
        Write-Host "=========================================" -ForegroundColor Green
        Write-Host "  重要：Client Secret" -ForegroundColor Green
        Write-Host "=========================================" -ForegroundColor Green
        Write-Host "Client ID: $BACKEND_CLIENT_ID" -ForegroundColor White
        Write-Host "Client Secret: $($secret.value)" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "请将此 Secret 保存到 server/.env.development 文件中：" -ForegroundColor Cyan
        Write-Host "KEYCLOAK_CLIENT_SECRET=$($secret.value)" -ForegroundColor White
        Write-Host "=========================================" -ForegroundColor Green
        Write-Host ""
        
        return $secret.value
    }
    catch {
        if ($_.Exception.Response.StatusCode -eq 409) {
            Write-Host "⚠ Client '$BACKEND_CLIENT_ID' 已存在" -ForegroundColor Yellow
            
            # 尝试获取现有 Client 的 Secret
            try {
                $clients = Invoke-RestMethod -Uri "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$BACKEND_CLIENT_ID" `
                    -Method Get `
                    -Headers $headers
                
                $clientUuid = $clients[0].id
                $secret = Invoke-RestMethod -Uri "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients/$clientUuid/client-secret" `
                    -Method Get `
                    -Headers $headers
                
                Write-Host ""
                Write-Host "现有 Client Secret: $($secret.value)" -ForegroundColor Yellow
                Write-Host ""
                
                return $secret.value
            }
            catch {
                Write-Host "⚠ 无法获取现有 Client Secret，请手动从 Keycloak 控制台获取" -ForegroundColor Yellow
            }
        }
        else {
            Write-Host "✗ 创建后端 Client 失败: $($_.Exception.Message)" -ForegroundColor Red
            throw
        }
    }
}

# 函数：创建前端 Client
function Create-FrontendClient {
    param($token)
    
    Write-Host ""
    Write-Host "正在创建前端 Client '$FRONTEND_CLIENT_ID'..." -ForegroundColor Yellow
    
    $headers = @{
        "Authorization" = "Bearer $token"
        "Content-Type"  = "application/json"
    }
    
    $clientConfig = @{
        clientId                  = $FRONTEND_CLIENT_ID
        enabled                   = $true
        protocol                  = "openid-connect"
        publicClient              = $true
        directAccessGrantsEnabled = $true
        standardFlowEnabled       = $true
        redirectUris              = @("http://localhost:3000/*")
        webOrigins                = @("http://localhost:3000")
        rootUrl                   = "http://localhost:3000"
    } | ConvertTo-Json
    
    try {
        Invoke-RestMethod -Uri "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients" `
            -Method Post `
            -Headers $headers `
            -Body $clientConfig `
            -ContentType "application/json"
        
        Write-Host "✓ 前端 Client '$FRONTEND_CLIENT_ID' 创建成功" -ForegroundColor Green
    }
    catch {
        if ($_.Exception.Response.StatusCode -eq 409) {
            Write-Host "⚠ Client '$FRONTEND_CLIENT_ID' 已存在，跳过创建" -ForegroundColor Yellow
        }
        else {
            Write-Host "✗ 创建前端 Client 失败: $($_.Exception.Message)" -ForegroundColor Red
            # 前端 Client 是可选的，不抛出异常
        }
    }
}

# 函数：创建测试用户
function Create-TestUser {
    param($token)
    
    Write-Host ""
    Write-Host "正在创建测试用户 '$TEST_USERNAME'..." -ForegroundColor Yellow
    
    $headers = @{
        "Authorization" = "Bearer $token"
        "Content-Type"  = "application/json"
    }
    
    $userConfig = @{
        username      = $TEST_USERNAME
        enabled       = $true
        emailVerified = $true
        email         = "testuser@example.com"
        firstName     = "Test"
        lastName      = "User"
        credentials   = @(
            @{
                type      = "password"
                value     = $TEST_PASSWORD
                temporary = $false
            }
        )
    } | ConvertTo-Json -Depth 10
    
    try {
        Invoke-RestMethod -Uri "$KEYCLOAK_URL/admin/realms/$REALM_NAME/users" `
            -Method Post `
            -Headers $headers `
            -Body $userConfig `
            -ContentType "application/json"
        
        Write-Host "✓ 测试用户 '$TEST_USERNAME' 创建成功" -ForegroundColor Green
        Write-Host "  用户名: $TEST_USERNAME" -ForegroundColor White
        Write-Host "  密码: $TEST_PASSWORD" -ForegroundColor White
    }
    catch {
        if ($_.Exception.Response.StatusCode -eq 409) {
            Write-Host "⚠ 用户 '$TEST_USERNAME' 已存在，跳过创建" -ForegroundColor Yellow
        }
        else {
            Write-Host "✗ 创建测试用户失败: $($_.Exception.Message)" -ForegroundColor Red
            throw
        }
    }
}

# 函数：更新环境配置文件
function Update-EnvFile {
    param($clientSecret)
    
    Write-Host ""
    Write-Host "正在更新 server/.env.development 文件..." -ForegroundColor Yellow
    
    $envFile = "server/.env.development"
    
    if (Test-Path $envFile) {
        $content = Get-Content $envFile -Raw
        
        # 更新 KEYCLOAK_ENABLED
        if ($content -match "KEYCLOAK_ENABLED=false") {
            $content = $content -replace "KEYCLOAK_ENABLED=false", "KEYCLOAK_ENABLED=true"
            Write-Host "✓ 已启用 KEYCLOAK_ENABLED=true" -ForegroundColor Green
        }
        
        # 更新或添加 KEYCLOAK_CLIENT_SECRET
        if ($clientSecret) {
            if ($content -match "# KEYCLOAK_CLIENT_SECRET=") {
                $content = $content -replace "# KEYCLOAK_CLIENT_SECRET=", "KEYCLOAK_CLIENT_SECRET=$clientSecret"
                Write-Host "✓ 已添加 KEYCLOAK_CLIENT_SECRET" -ForegroundColor Green
            }
            elseif ($content -match "KEYCLOAK_CLIENT_SECRET=") {
                $content = $content -replace "KEYCLOAK_CLIENT_SECRET=.*", "KEYCLOAK_CLIENT_SECRET=$clientSecret"
                Write-Host "✓ 已更新 KEYCLOAK_CLIENT_SECRET" -ForegroundColor Green
            }
            else {
                # 在 KEYCLOAK_CLIENT_ID 后面添加
                $content = $content -replace "(KEYCLOAK_CLIENT_ID=anythingllm-backend)", "`$1`nKEYCLOAK_CLIENT_SECRET=$clientSecret"
                Write-Host "✓ 已添加 KEYCLOAK_CLIENT_SECRET" -ForegroundColor Green
            }
        }
        
        Set-Content -Path $envFile -Value $content -NoNewline
        Write-Host "✓ 环境配置文件更新成功" -ForegroundColor Green
    }
    else {
        Write-Host "⚠ 找不到 $envFile 文件" -ForegroundColor Yellow
    }
}

# 主执行流程
try {
    Write-Host "开始配置 Keycloak..." -ForegroundColor Cyan
    Write-Host ""
    
    # 1. 获取管理员令牌
    $adminToken = Get-AdminToken
    
    # 2. 创建 Realm
    Create-Realm -token $adminToken
    
    # 3. 创建后端 Client
    $clientSecret = Create-BackendClient -token $adminToken
    
    # 4. 创建前端 Client（可选）
    Create-FrontendClient -token $adminToken
    
    # 5. 创建测试用户
    Create-TestUser -token $adminToken
    
    # 6. 更新环境配置文件
    if ($clientSecret) {
        Update-EnvFile -clientSecret $clientSecret
    }
    
    Write-Host ""
    Write-Host "=========================================" -ForegroundColor Green
    Write-Host "  配置完成！" -ForegroundColor Green
    Write-Host "=========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "下一步：" -ForegroundColor Cyan
    Write-Host "1. 启动后端服务器：" -ForegroundColor White
    Write-Host "   cd server" -ForegroundColor Gray
    Write-Host "   yarn dev" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. 运行测试脚本：" -ForegroundColor White
    Write-Host "   node test-keycloak-integration.js" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. 或手动测试获取令牌：" -ForegroundColor White
    Write-Host "   curl -X POST `"http://localhost:8080/realms/anythingllm/protocol/openid-connect/token`" \" -ForegroundColor Gray
    Write-Host "     -d `"grant_type=password`" \" -ForegroundColor Gray
    Write-Host "     -d `"client_id=anythingllm-backend`" \" -ForegroundColor Gray
    Write-Host "     -d `"client_secret=$clientSecret`" \" -ForegroundColor Gray
    Write-Host "     -d `"username=testuser`" \" -ForegroundColor Gray
    Write-Host "     -d `"password=testpass123`"" -ForegroundColor Gray
    Write-Host ""
    
}
catch {
    Write-Host ""
    Write-Host "=========================================" -ForegroundColor Red
    Write-Host "  配置失败" -ForegroundColor Red
    Write-Host "=========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "错误信息: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "请检查：" -ForegroundColor Yellow
    Write-Host "1. Keycloak 是否在运行（http://localhost:8080）" -ForegroundColor White
    Write-Host "2. 管理员用户名和密码是否正确" -ForegroundColor White
    Write-Host "3. 查看详细错误信息" -ForegroundColor White
    Write-Host ""
    exit 1
}
