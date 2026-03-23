declare module 'ml-cart' {
  export class DecisionTreeClassifier {
    constructor(options?: any);
    train(features: number[][], labels: number[]): void;
    predict(features: number[][]): number[];
    toJSON(): any;
    static load(model: any): DecisionTreeClassifier;
  }
}
