function Get-OrgData {
    param (
        # Org id to get data for
        [Int32]
        $OrganizationID,
        # Github token
        [String]
        $Token
    )
    # Get data from the REST api
    $headers = @{
        "Accept" = "application/vnd.github.v3+json"
        "Authorization" = "Bearer $token"
    }
    $orgData = Invoke-RestMethod -Uri "https://api.github.com/orgs/$OrganizationID" -Method Get -Headers $headers
    return $orgData
}

$data = Get-Content /home/runner/work/github-portal/github-portal/app_output.json -Raw | ConvertFrom-Json

$insertData = @()

foreach ($item in $data) {
    Write-Output "Getting data for Org: $($item.account.id)"
    $orgData = Get-OrgData -OrganizationID $item.account.id -Token $env:PAT
    $insertData += [PSCustomObject]@{
        type = @("public", "private", "internal")
        active = $true
        portaldescription = $orgData.description
        updated = get-date -format yyyy-MM-ddTHH:mm:ssZ
        installations = @( 
            @{
                appId = $item.app_id
                installationId = $item.id
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
