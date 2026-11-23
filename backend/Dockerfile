FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY NuGet.Config ./
COPY backend/NexoCrm.Api.csproj backend/
RUN dotnet restore backend/NexoCrm.Api.csproj --configfile NuGet.Config
COPY backend/ backend/
RUN dotnet publish backend/NexoCrm.Api.csproj -c Release --no-restore -o /app/out

FROM mcr.microsoft.com/dotnet/aspnet:10.0
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
