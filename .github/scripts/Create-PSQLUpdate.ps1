function Get-InstallationToken {
    param (
        [Int32]
        # The app install ID for the org, used to generate the installation token
        $InstallationID,
        # Github token
        [String]
        $JWT
    )
    # Get an installation token for the org
    $headers = @{
        "Accept" = "application/vnd.github.v3+json"
        "Authorization" = "Bearer $JWT"
    }

    $response = Invoke-RestMethod -Uri "https://api.github.com/app/installations/$InstallationID/access_tokens" -Method Post -Headers $headers
    return $response.token
}


function Get-OrgData {
    param (
        # Org id to get data for
        [Int32]
        $OrganizationID,
        # Github app token
        [String]
        $InstallationToken
    )
    # Get data from the REST api
    $headers = @{
        "Accept" = "application/vnd.github.v3+json"
        "Authorization" = "Bearer $InstallationToken"
    }
    $orgData = Invoke-RestMethod -Uri "https://api.github.com/orgs/$OrganizationID" -Method Get -Headers $headers
    return $orgData
}

$data = Get-Content /home/runner/work/github-portal/github-portal/app_output.json -Raw | ConvertFrom-Json

$insertData = @()

foreach ($item in $data) {
    Write-Output "Getting data for Org: $($item.account.id)"
    $org_installation_token = Get-InstallationToken -InstallationID $item.id -JWT (Get-Content token)
    $orgData = Get-OrgData -OrganizationID $item.account.id -InstallationToken $org_installation_token
    if ($orgData.description -ne $null) {
        $processed_description = $orgData.description.Replace("'", "''")
    }
    else {
        $processed_description = $orgData.description
    }
    if ($item.repository_selection -ne "all") {
        Write-Output "Org $($item.account.login) does not have all repositories selected. This can cause issues with the portal."
    }
    $insertData += [PSCustomObject]@{
        type = @("public", "private", "internal")
        active = $true
        portaldescription = $processed_description
        updated = get-date -format yyyy-MM-ddTHH:mm:ssZ
        installations = @( 
            @{
                appId = $item.app_id
                installationId = $item.id
                repositoryAccess = $item.repository_selection
            }
        )
        organizationid = $item.account.id
        organizationname = $item.account.login
        features = @("locked", "createReposDirect")
    }
}

$insertData 

# test if the file exists
if (Test-Path ./update.sql) {
    # if it does, delete it
    Remove-Item ./update.sql -Force
}

# make new empty sql file
New-Item -Path ./update.sql -ItemType File -Force

# add heredoc to to the file to start a sql transaction and remove the rows from the organizationsettings table
$deleteRows = @"
BEGIN;
DELETE FROM organizationsettings;
COMMIT;
"@

$deleteRows | Out-File -FilePath ./update.sql -Append

"BEGIN;" | Out-File -FilePath ./update.sql -Append

# loop through the data and add the insert statements to the sql file
foreach ($item in $insertData) {
    $jsonBlob = $item | ConvertTo-Json -Compress
    $insertStatement = @"
    INSERT INTO public.organizationsettings
    VALUES ('organizationsetting', $($item.organizationid), '$jsonBlob');
"@
    $insertStatement | Out-File -FilePath ./update.sql -Append
}

"COMMIT;" | Out-File -FilePath ./update.sql -Append
