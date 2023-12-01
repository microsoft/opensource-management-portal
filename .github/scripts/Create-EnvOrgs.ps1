$output = Get-Content ./raw.json | ConvertFrom-Json

Write-Output $output.data.enterprise.organizations.nodes


$orgsArray = @()

foreach ($org in $output.data.enterprise.organizations.nodes) {
  $envObj = [PSCustomObject]@{
    name        = "$($org.login)"
    id          = $($org.databaseId)
    type        = @("public", "private")
    description = "$($org.description)"
    locked      = $True
  }

  $orgsArray += $envObj
  Write-Output $orgsArray
}

$orgsArray | ConvertTo-Json -Depth 10 | Out-File -FilePath "orgs.json"
