FROM node:24-alpine AS web-build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY NuGet.Config ./
COPY backend/NexoCrm.Api.csproj backend/
RUN dotnet restore backend/NexoCrm.Api.csproj --configfile NuGet.Config
COPY backend/ backend/
RUN dotnet publish backend/NexoCrm.Api.csproj -c Release --no-restore -o /app/out

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS api
WORKDIR /app
COPY --from=build /app/out/ .
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o app -g app /keys
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER app
ENTRYPOINT ["dotnet", "NexoCrm.Api.dll"]

FROM api AS cloud
COPY --from=web-build /src/dist/crm/browser/ /app/wwwroot/
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_FORWARDEDHEADERS_ENABLED=true \
    BumiCloud__PersistKeys=true
