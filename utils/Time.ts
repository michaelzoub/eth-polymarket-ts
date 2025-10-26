

export default new class Time {
    getCurrentETTime(): Date {
    return new Date(
        new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
    );
    };

    isPastNoon = (): boolean => {
    const now = this.getCurrentETTime();
    return now.getHours() >= 12 && now.getMinutes() >= 1;
    };

     getNextMarketSlug(afterNoon: boolean): string {
    const current = this.getCurrentETTime();
    const target = afterNoon
        ? new Date(current.getTime() + 24 * 60 * 60 * 1000)
        : current;

    const month = target.toLocaleString("en-US", { month: "long" }).toLowerCase();
    const day = target.getDate();

    return `ethereum-price-on-${month}-${day}`;
    };
}